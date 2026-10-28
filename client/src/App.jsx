
import { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import "./App.css";

// Production uses the Vercel environment variable.
// Local development falls back to localhost.
const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const socket = io(API_URL, { autoConnect: false });

function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("chatUser") || "null");
    } catch {
      return null;
    }
  });

  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const currentUserId = user?.id || user?._id;
  const selectedUserId = selectedUser?._id || selectedUser?.id;

  useEffect(() => {
    if (!user || !localStorage.getItem("chatToken")) {
      socket.disconnect();
      setConnected(false);
      return;
    }

    let active = true;
    const token = localStorage.getItem("chatToken");

    socket.auth = { token };

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onOnlineUsers = (ids) => setOnlineUsers(ids);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("online_users", onOnlineUsers);

    axios
      .get(`${API_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        if (active) setUsers(response.data);
      })
      .catch((err) => {
        if (active) {
          setError(
            err.response?.data?.message ||
              "Could not load users. Please log in again."
          );
        }
      });

    socket.connect();

    return () => {
      active = false;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("online_users", onOnlineUsers);
      socket.disconnect();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !selectedUserId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let active = true;
    const token = localStorage.getItem("chatToken");

    setMessages([]);
    setLoading(true);
    setError("");

    axios
      .get(`${API_URL}/api/messages/${selectedUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        if (active) setMessages(response.data);
      })
      .catch((err) => {
        if (active) {
          setError(
            err.response?.data?.message ||
              "Could not load this conversation."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, selectedUserId]);

  useEffect(() => {
    if (!user) return;

    const onPrivateMessage = (data) => {
      const senderId = String(data.senderId?._id || data.senderId);
      const receiverId = String(data.receiverId?._id || data.receiverId);
      const otherId = String(selectedUser?._id || selectedUser?.id || "");

      if (
        otherId &&
        ((senderId === String(currentUserId) && receiverId === otherId) ||
          (senderId === otherId && receiverId === String(currentUserId)))
      ) {
        setMessages((previous) => {
          if (data._id && previous.some((item) => item._id === data._id)) {
            return previous;
          }
          return [...previous, data];
        });
      }
    };

    socket.on("private_message", onPrivateMessage);

    return () => {
      socket.off("private_message", onPrivateMessage);
    };
  }, [user, selectedUser, currentUserId]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const endpoint =
        mode === "signup" ? "/api/auth/register" : "/api/auth/login";

      const payload =
        mode === "signup"
          ? { name: name.trim(), email: email.trim(), password }
          : { email: email.trim(), password };

      const response = await axios.post(`${API_URL}${endpoint}`, payload);

      localStorage.setItem("chatToken", response.data.token);
      localStorage.setItem("chatUser", JSON.stringify(response.data.user));

      setUser(response.data.user);
      setPassword("");
      setSelectedUser(null);
      setMessages([]);
      setUsers([]);
      setOnlineUsers([]);
      setError("");
    } catch (err) {
      setAuthError(
        err.response?.data?.message ||
          "Something went wrong. Please try again."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    socket.disconnect();
    localStorage.removeItem("chatToken");
    localStorage.removeItem("chatUser");

    setUser(null);
    setUsers([]);
    setSelectedUser(null);
    setMessages([]);
    setOnlineUsers([]);
    setMessage("");
    setConnected(false);
    setEmail("");
    setPassword("");
    setName("");
    setAuthError("");
    setError("");
  };

  const sendMessage = (e) => {
    e.preventDefault();

    const text = message.trim();

    if (!text || !connected || !selectedUserId) return;

    socket.emit(
      "send_private_message",
      { receiverId: selectedUserId, text },
      (response) => {
        if (response?.error) {
          setError(response.error);
        } else {
          setError("");
        }
      }
    );

    setMessage("");
  };

  const isOnline = (person) =>
    onlineUsers.includes(String(person._id || person.id));

  if (!user) {
    return (
      <div className="app">
        <main className="chat auth-screen">
          <div className="auth-card">
            <h1>ChatWave</h1>
            <p className="subtitle">Real-Time Messaging</p>

            <h2>{mode === "signup" ? "Create Account" : "Welcome Back"}</h2>
            <p>
              {mode === "signup"
                ? "Join ChatWave and start chatting."
                : "Login to continue to your chats."}
            </p>

            <form className="auth-form" onSubmit={handleAuth}>
              {mode === "signup" && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  maxLength={50}
                  required
                />
              )}

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
              />

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (minimum 6 characters)"
                minLength={6}
                required
              />

              {authError && <p className="auth-error">{authError}</p>}

              <button type="submit" disabled={authLoading}>
                {authLoading
                  ? "Please wait..."
                  : mode === "signup"
                    ? "Create Account"
                    : "Login"}
              </button>
            </form>

            <p className="auth-switch">
              {mode === "signup"
                ? "Already have an account?"
                : "New to ChatWave?"}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode(mode === "signup" ? "login" : "signup");
                  setAuthError("");
                }}
              >
                {mode === "signup" ? "Login" : "Sign up"}
              </button>
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>ChatWave</h2>
        <p className="subtitle">Private Real-Time Messaging</p>

        <div className="section-heading">YOUR CONTACTS ({users.length})</div>

        <div className="online-users-list">
          {users.length === 0 ? (
            <p className="online-empty">
              No other users yet. Create another account to test chat.
            </p>
          ) : (
            users.map((person) => {
              const personId = String(person._id || person.id);
              const active = personId === String(selectedUserId || "");

              return (
                <button
                  type="button"
                  key={personId}
                  className={`contact ${active ? "active-contact" : ""}`}
                  onClick={() => {
                    setSelectedUser(person);
                    setError("");
                  }}
                >
                  <div className="avatar">
                    {(person.name || person.email || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </div>

                  <div className="online-user-info">
                    <h4>{person.name || person.email}</h4>
                    <p>
                      <span
                        className={`online-dot ${
                          isOnline(person) ? "" : "offline-dot"
                        }`}
                      />
                      {isOnline(person) ? "Online" : "Offline"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="sidebar-footer">
          <p>{user.name}</p>
          <p>{user.email}</p>
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div className="avatar">
            {selectedUser
              ? (selectedUser.name || selectedUser.email || "U")
                  .charAt(0)
                  .toUpperCase()
              : "C"}
          </div>

          <div>
            <h3>
              {selectedUser
                ? selectedUser.name || selectedUser.email
                : "Welcome to ChatWave"}
            </h3>
            <p className="status">
              {connected ? "● Live connection" : "○ Connecting to server..."}
              {selectedUser
                ? ` · ${isOnline(selectedUser) ? "Online" : "Offline"}`
                : ""}
            </p>
          </div>
        </header>

        <section className="messages">
          {!selectedUser ? (
            <p className="empty-message">
              Select a contact from the left to start a private conversation.
            </p>
          ) : (
            <>
              <div className="date-label">
                PRIVATE CHAT · {selectedUser.name || selectedUser.email}
              </div>

              {loading && (
                <p className="empty-message">Loading conversation...</p>
              )}

              {error && <p className="empty-message">{error}</p>}

              {!loading && messages.length === 0 && !error && (
                <p className="empty-message">No messages yet. Say hello!</p>
              )}

              {messages.map((item, index) => {
                const senderId = String(
                  item.senderId?._id || item.senderId || ""
                );
                const isMine = senderId === String(currentUserId);

                return (
                  <div
                    key={item._id || index}
                    className={`message-row ${isMine ? "sent" : "received"}`}
                  >
                    <div className="bubble">
                      <div>{item.text}</div>
                      <small>
                        {isMine ? "You" : item.senderName || selectedUser.name}
                        {" · "}
                        {item.time ||
                          (item.createdAt
                            ? new Date(item.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "")}
                      </small>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </section>

        <form className="message-form" onSubmit={sendMessage}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              selectedUser
                ? "Type your private message..."
                : "Select a contact first"
            }
            disabled={!connected || !selectedUser}
            maxLength={2000}
          />

          <button
            type="submit"
            disabled={!connected || !selectedUser || !message.trim()}
          >
            Send ➤
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;
