const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const usersPath = path.join(dataDir, "users.json");
const sessions = new Map();

function ensureStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, "[]");
}

function readUsers() {
  ensureStore();
  return JSON.parse(fs.readFileSync(usersPath, "utf8"));
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function createUser({ name, email, organization, password }) {
  const users = readUsers();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password || !name) {
    throw new Error("Name, email, and password are required.");
  }

  if (users.some((user) => user.email === normalizedEmail)) {
    throw new Error("An account already exists for this email.");
  }

  const passwordHash = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normalizedEmail,
    organization: String(organization || "SolarIQ").trim(),
    salt: passwordHash.salt,
    passwordHash: passwordHash.hash,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeUsers(users);
  return publicUser(user);
}

function verifyUser(email, password) {
  const users = readUsers();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = users.find((item) => item.email === normalizedEmail);
  if (!user) return null;

  const attempted = hashPassword(password, user.salt);
  if (attempted.hash !== user.passwordHash) return null;
  return publicUser(user);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organization: user.organization,
    createdAt: user.createdAt
  };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, user);
  return token;
}

function getSession(token) {
  return sessions.get(token);
}

function deleteSession(token) {
  sessions.delete(token);
}

module.exports = {
  createUser,
  verifyUser,
  createSession,
  getSession,
  deleteSession
};
