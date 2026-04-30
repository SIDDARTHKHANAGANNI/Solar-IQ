require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const apiRoutes = require("./routes/api");
const { createUser, verifyUser, createSession, getSession, deleteSession } = require("./services/authStore");

const app = express();
const port = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...value] = cookie.trim().split("=");
        return [key, decodeURIComponent(value.join("="))];
      })
  );
}

function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies.solariq_session;
  req.user = req.sessionToken ? getSession(req.sessionToken) : null;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect("/signin");
}

app.use(attachUser);

// MongoDB is optional. The application keeps working with generated data if it
// cannot connect to a local or hosted database.
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((error) => console.warn("MongoDB unavailable, using fallback mode:", error.message));
}

function renderPage(req, res, page, pageTitle) {
  res.render("index", {
    appName: "SolarIQ",
    page,
    pageTitle,
    user: req.user,
    aiUrl: process.env.FLASK_AI_URL || "http://127.0.0.1:5001"
  });
}

app.get("/signin", (req, res) => {
  if (req.user) return res.redirect("/");
  return res.render("auth", { mode: "signin", error: null });
});

app.post("/signin", (req, res) => {
  const user = verifyUser(req.body.email, req.body.password);
  if (!user) return res.status(401).render("auth", { mode: "signin", error: "Invalid email or password." });

  const token = createSession(user);
  res.setHeader("Set-Cookie", `solariq_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`);
  return res.redirect("/");
});

app.get("/signup", (req, res) => {
  if (req.user) return res.redirect("/");
  return res.render("auth", { mode: "signup", error: null });
});

app.post("/signup", (req, res) => {
  try {
    const user = createUser(req.body);
    const token = createSession(user);
    res.setHeader("Set-Cookie", `solariq_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`);
    return res.redirect("/");
  } catch (error) {
    return res.status(400).render("auth", { mode: "signup", error: error.message });
  }
});

app.post("/logout", (req, res) => {
  if (req.sessionToken) deleteSession(req.sessionToken);
  res.setHeader("Set-Cookie", "solariq_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  return res.redirect("/signin");
});

app.get("/", requireAuth, (req, res) => {
  renderPage(req, res, "home", "Home");
});

app.get("/ai-energy", requireAuth, (req, res) => {
  renderPage(req, res, "ai-energy", "AI Energy Generation Estimation");
});

app.get("/planning", requireAuth, (req, res) => {
  renderPage(req, res, "planning", "Pre-Installation Planning");
});

app.get("/carbon", requireAuth, (req, res) => {
  renderPage(req, res, "carbon", "Carbon Credits");
});

app.get("/admin", requireAuth, (req, res) => {
  renderPage(req, res, "admin", "Admin Profile");
});

app.get("/installation", requireAuth, (req, res) => {
  res.render("installation1");
});

app.post("/installation", requireAuth, (req, res) => {
  // Dummy - data not used anywhere
  console.log("Installation data received:", req.body);
  return res.redirect("/");
});

app.use("/api", apiRoutes);

app.listen(port, () => {
  console.log(`SolarIQ running at http://localhost:${port}`);
});

