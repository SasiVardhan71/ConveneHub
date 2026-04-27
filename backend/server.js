require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const TierSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  price:    { type: Number, required: true },
  quantity: { type: Number, required: true },
});

const UserSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role:     { type: String, enum: ["attendee", "organizer", "promoter", "admin"], default: "attendee" },
    campus:   { type: String, default: "" },
  },
  { timestamps: true }
);

const EventSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },
    description: { type: String, default: "" },
    date:        { type: String, required: true },   
    venue:       { type: String, default: "" },
    campus:      { type: String, default: "" },
    posterUrl:   { type: String, default: "" },
    organizerId: { type: String, required: true },  
    capacity:    { type: Number, default: 0 },
    tiers:       [TierSchema],
  },
  { timestamps: true }
);

const TicketSchema = new mongoose.Schema(
  {
    userId:       { type: String, required: true },
    eventId:      { type: String, required: true },
    tierId:       { type: String, required: true },
    referralCode: { type: String, default: "" },
    checkedIn:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

const ReferralSchema = new mongoose.Schema(
  {
    userId:            { type: String, required: true },
    eventId:           { type: String, required: true },
    code:              { type: String, required: true },
    commissionPercent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const User     = mongoose.model("User",     UserSchema);
const Event    = mongoose.model("Event",    EventSchema);
const Ticket   = mongoose.model("Ticket",   TicketSchema);
const Referral = mongoose.model("Referral", ReferralSchema);

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password, role, campus } = req.body;

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.json({ error: "User already exists" });

    const user = await User.create({ name, email, password, role, campus });
    res.json(user);
  })
);


app.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      password,
    });

    if (!user) return res.json({ error: "Invalid credentials" });
    res.json(user);
  })
);

app.post(
  "/events",
  asyncHandler(async (req, res) => {
    const event = await Event.create(req.body);
    res.json(event);
  })
);

app.get(
  "/events",
  asyncHandler(async (_req, res) => {
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  })
);

app.get(
  "/events/:id",
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.json({ error: "Event not found" });
    res.json(event);
  })
);

app.post(
  "/tickets",
  asyncHandler(async (req, res) => {
    const { eventId, tierId, referralCode, userId } = req.body;

    if (referralCode && referralCode.trim()) {
      const validCode = await Referral.findOne({
        eventId,
        code: referralCode.trim().toUpperCase(),
      });
      if (!validCode) return res.json({ error: "Referral code not found for this event" });
    }

    const soldForTier = await Ticket.countDocuments({ eventId, tierId });
    const event = await Event.findById(eventId);
    if (!event) return res.json({ error: "Event not found" });

    const tier = event.tiers.id(tierId);
    if (!tier) return res.json({ error: "Ticket tier not found" });
    if (soldForTier >= tier.quantity) return res.json({ error: "Selected ticket tier is sold out" });

    const ticket = await Ticket.create({
      userId,
      eventId,
      tierId,
      referralCode: referralCode ? referralCode.trim().toUpperCase() : "",
      checkedIn: false,
    });

    res.json(ticket);
  })
);

app.get(
  "/tickets/:userId",
  asyncHandler(async (req, res) => {
    const tickets = await Ticket.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(tickets);
  })
);

app.post(
  "/checkin",
  asyncHandler(async (req, res) => {
    const { ticketId } = req.body;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) return res.json({ error: "Ticket not found" });
    if (ticket.checkedIn) return res.json({ error: "Ticket is already checked in" });

    ticket.checkedIn = true;
    await ticket.save();

    res.json(ticket);
  })
);

app.post(
  "/referrals",
  asyncHandler(async (req, res) => {
    const { eventId, code, userId, commissionPercent } = req.body;

    const exists = await Referral.findOne({
      eventId,
      code: code.trim().toUpperCase(),
    });
    if (exists) return res.json({ error: "Code already exists for this event" });

    const referral = await Referral.create({
      userId,
      eventId,
      code: code.trim().toUpperCase(),
      commissionPercent,
    });

    res.json(referral);
  })
);

app.get(
  "/referrals/:userId",
  asyncHandler(async (req, res) => {
    const referrals = await Referral.find({ userId: req.params.userId });
    res.json(referrals);
  })
);

app.get(
  "/referrals/event/:eventId",
  asyncHandler(async (req, res) => {
    const referrals = await Referral.find({ eventId: req.params.eventId });
    res.json(referrals);
  })
);

app.get(
  "/admin/stats",
  asyncHandler(async (_req, res) => {
    const [userCount, eventCount, ticketCount, referralCount] = await Promise.all([
      User.countDocuments(),
      Event.countDocuments(),
      Ticket.countDocuments(),
      Referral.countDocuments(),
    ]);
    res.json({ userCount, eventCount, ticketCount, referralCount });
  })
);

app.get(
  "/admin/users",
  asyncHandler(async (_req, res) => {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  })
);

app.get(
  "/admin/tickets",
  asyncHandler(async (_req, res) => {
    const tickets = await Ticket.find().sort({ createdAt: -1 });
    res.json(tickets);
  })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(process.env.PORT, () => {
  console.log(`ConveneHub server running on http://localhost:${process.env.PORT}`);
});
