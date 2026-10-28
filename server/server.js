
const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const messageSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, maxlength: 2000 },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: { type: String, required: true },
    time: { type: String, required: true },
  },
  { timestamps: true }
);

const Message = mongoose.model("Message", messageSchema);

function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Login required." });
  }

  try {
    req.authUser = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Session expired. Please log in again.",
    });
  }
}

app.get("/", (req, res) => {
  res.json({ message: "ChatWave API is running!" });
});

// SIGNUP
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        message: "Name, email and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
    });

    res.status(201).json({
      message: "Account created successfully.",
      token: createToken(user),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ message: "Could not create account." });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    res.json({
      message: "Login successful.",
      token: createToken(user),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Could not log in." });
  }
});

// GET USERS (requires login)
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.authUser.id },
    })
      .select("name email")
      .sort({ name: 1 });

    res.json(users);
  } catch (error) {
    console.error("Users error:", error.message);
    res.status(500).json({ message: "Could not load users." });
  }
});

// GET PRIVATE CONVERSATION (requires login)
app.get("/api/messages/:userId", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }

    const otherUser = await User.findById(userId).select("_id");

    if (!otherUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const currentId = new mongoose.Types.ObjectId(req.authUser.id);
    const otherId = new mongoose.Types.ObjectId(userId);

    const messages = await Message.find({
      $or: [
        { senderId: currentId, receiverId: otherId },
        { senderId: otherId, receiverId: currentId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(500);

    res.json(messages);
  } catch (error) {
    console.error("Private history error:", error.message);
    res.status(500).json({ message: "Could not load conversation." });
  }
});

// ONLINE USERS: map user IDs to active socket IDs
const onlineUsers = new Map();

function broadcastOnlineUsers() {
  io.emit("online_users", Array.from(onlineUsers.keys()));
}

// Authenticate Socket.IO connections using JWT
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required."));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.user = {
      id: payload.id,
      name: payload.name,
    };

    next();
  } catch {
    next(new Error("Invalid or expired token."));
  }
});

io.on("connection", (socket) => {
  const currentUser = socket.data.user;
  const userId = currentUser.id;

  console.log("Authenticated user connected:", userId);

  // Support multiple tabs for the same user
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);
  broadcastOnlineUsers();

  // Send a private message to one selected recipient
  socket.on("send_private_message", async (data, callback) => {
    try {
      const receiverId = String(data?.receiverId || "");
      const text = String(data?.text || "").trim();

      if (!mongoose.isValidObjectId(receiverId)) {
        return callback?.({ error: "Invalid recipient." });
      }

      if (!text || text.length > 2000) {
        return callback?.({ error: "Enter a message up to 2000 characters." });
      }

      if (receiverId === userId) {
        return callback?.({ error: "You cannot message yourself." });
      }

      const receiver = await User.findById(receiverId).select("name");

      if (!receiver) {
        return callback?.({ error: "Recipient not found." });
      }

      const savedMessage = await Message.create({
        text,
        senderId: userId,
        receiverId,
        senderName: currentUser.name,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      const payload = {
        _id: savedMessage._id.toString(),
        text: savedMessage.text,
        senderId: userId,
        receiverId,
        senderName: currentUser.name,
        time: savedMessage.time,
        createdAt: savedMessage.createdAt,
      };

      // Deliver only to sender and recipient
      socket.emit("private_message", payload);

      const recipientSockets = onlineUsers.get(receiverId);

      if (recipientSockets) {
        for (const socketId of recipientSockets) {
          io.to(socketId).emit("private_message", payload);
        }
      }

      callback?.({ success: true });
    } catch (error) {
      console.error("Private message error:", error.message);
      callback?.({ error: "Could not send message." });
    }
  });

  socket.on("disconnect", () => {
    const sockets = onlineUsers.get(userId);

    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        onlineUsers.delete(userId);
      }
    }

    broadcastOnlineUsers();
    console.log("User disconnected:", userId);
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
      throw new Error("MONGO_URI and JWT_SECRET are required in .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error.message);
    process.exit(1);
  }
}

startServer();
