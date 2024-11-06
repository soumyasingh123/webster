import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer";
import fs from "fs";
import path from "path";
import session from "express-session";
import axios from "axios";
import cors from "cors";
import { error } from "console";

const app = express();
const port = 3000;
const API_URL = "http://localhost:4000";
const API2_URL = "http://localhost:5000";

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(bodyParser.json());

app.use(
  session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set `secure: true` for HTTPS
  })
);
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "webster",
  password: "mycreations",
  port: 5432,
});

db.connect().catch((err) => console.error("Connection error", err.stack));

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { username, password, email } = req.body;

  try {
    const checkResult = await db.query(
      "SELECT * FROM user_webster WHERE email = $1",
      [email]
    );

    if (checkResult.rows.length > 0) {
      const error = "Email already exists. Try logging in.";
      res.render("register", { error });
    } else {
      const insertResult = await db.query(
        "INSERT INTO user_webster (username, email, password) VALUES ($1, $2, $3) RETURNING id",
        [username, email, password]
      );
      req.session.userId = insertResult.rows[0].id; // Set session userId for file storage
      res.redirect("/explore"); // Redirect to explore page after registration
    }
  } catch (err) {
    console.error(err);
    res.render("register", { error: "An error occurred. Please try again." });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query(
      "SELECT * FROM user_webster WHERE username = $1",
      [username]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (password === user.password) {
        req.session.userId = user.id;
        res.redirect("/explore");
        console.log("Logging in user:", username);
        console.log("Password check:", password, user.password);
        console.log("Setting session userId:", user.id);
      } else {
        const error = "Incorrect password, try again!";
        res.render("login", { error });
      }
    } else {
      const error = "User not found, try registering!";
      res.render("login", { error });
    }
  } catch (err) {
    console.error(err);
    const error = "Some error occurred . Please try again.";
    res.render("login", { error });
  }
});

app.get("/explore", async (req, res) => {
  try {
    const filesQuery = `
          SELECT file_id, file_name, file_path, like_count, dislike_count, upload_date
          FROM files
          ORDER BY upload_date DESC
      `;
    const filesResult = await db.query(filesQuery);

    res.render("explore", {
      allFiles: filesResult.rows,
      userId: req.session.userId, // assuming you set userId in the session
    });
  } catch (error) {
    console.error("Error retrieving files:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/uploadFile", (req, res) => {
  res.redirect("/userFiles");
});

app.get("/userFiles", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect("/login");

  try {
    const response = await axios.get(`${API_URL}/api/userFiles/${userId}`);
    const files = response.data?.files || []; // Fallback to empty array if files are undefined
    res.render("uploads", { files, userId });
  } catch (error) {
    console.error("Error fetching files:", error);
    res
      .status(500)
      .render("uploads", { files: [], userId, error: "Error fetching files" });
  }
});


app.get("/leaderboard", async (req, res) => {
  try {
    const filesQuery = `
          SELECT username, points
          FROM user_webster
          ORDER BY points DESC
      `;
    const users = await db.query(filesQuery);
    res.render("leaderboard", { users: users.rows, error: "" }); // Renamed 'files' to 'users'
  } catch (error) {
    const err = "Error loading leaderboard!";
    console.error(error);
    res.render("leaderboard", { users: [], error: err }); // Keep the empty array and display error
  }
});

app.post("/battles/create", async (req, res) => {
  try {
    const user_id = req.session.userId;
    const challengerName = req.body.challengerUsername;

    const result = await db.query(
      "SELECT * FROM user_webster WHERE username = $1",
      [challengerName]
    );
    const usernameResult = await db.query(
      "SELECT username FROM user_webster WHERE id = $1",
      [user_id]
    );
    const Username = usernameResult.rows[0];
    console.log(user_id);
    console.log(Username);
    if (result.rows.length > 0) {
      const challengerId = result.rows[0].id;
      await db.query(
        `INSERT INTO battle_messages (user_id, challenger_id) VALUES ($1, $2)`,
        [user_id, challengerId]
      );
      res.render("battle", { error: "", messages: {} });
    } else {
      console.log("user not found");
      res.render("battle", { error: "User not found" });
    }
  } catch (err) {
    console.error(err);
    res.render("battle", {
      error: "An error occurred while sending the challenge.",
    });
  }
});

app.get("/battles", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect("/login"); // Ensure user is logged in

  try {
    const result2 = await db.query(
      "SELECT * FROM battle_messages WHERE challenger_id = $1 AND status = 'pending'",
      [userId]
    );

    const result1 = await db.query(
      "SELECT * FROM battle_messages WHERE (user_id = $1 OR challenger_id=$1) AND (status = 'accepted')",
      [userId]
    );
    const result3 = await db.query("SELECT * FROM battle_messages");
    const messages = result2.rows || [];
    const yourBattles = result1.rows || [];

    res.render("battle", { messages, yourBattles });
  } catch (err) {
    console.error(err);
    res.render("battle", {
      messages: [],
      yourBattles: [],
      error: "An error occurred while fetching battles.",
    });
  }
});

app.post("/battles/:battleId/accept", async (req, res) => {
  const battleId = req.params.battleId;
  try {
    await db.query(
      "UPDATE battle_messages SET status = 'accepted' WHERE id = $1",
      [battleId]
    );
    res.redirect("/battles");
  } catch (error) {
    res.render("battle", { error: "an error occured" });
  }
});

app.get("/arena/:id", async (req, res) => {
  const battleId = req.params.id;
  const currentUserId = req.session.userId;
  const { userId } = req.body;

  try {
    // Fetch data related to the battle
    const battleData = await db.query(
      "SELECT * FROM battle_messages WHERE id = $1",
      [battleId]
    );

    const username1result = await db.query(
      "SELECT username FROM user_webster WHERE id = $1",
      [battleData.rows[0].user_id]
    );
    const username2result = await db.query(
      "SELECT username FROM user_webster WHERE id = $1",
      [battleData.rows[0].challenger_id]
    );
    const username1 = username1result.rows[0].username;
    const username2 = username2result.rows[0].username;

    // Check if the battle already exists in the battles table
    const existingBattleResult = await db.query(
      "SELECT * FROM battles WHERE battle_id = $1 AND username1 = $2 AND username2 = $3",
      [battleId, username1, username2]
    );

    // If it doesn't exist, insert the new battle
    if (existingBattleResult.rows.length === 0) {
      await db.query(
        "INSERT INTO battles (username1, username2, battle_id) VALUES ($1, $2, $3)",
        [username1, username2, battleId]
      );
    }

    // Fetch battle details
    const battleDetails = await db.query(
      "SELECT * FROM battles WHERE battle_id = $1",
      [battleId]
    );
    let startClock = 0;
    let setClock = false;
    if (
      battleDetails.rows[0].artist1_trackpath != null &&
      battleDetails.rows[0].artist2_trackpath != null
    ) {
      setClock = true;
      const user1time = await db.query("SELECT upload_date FROM files WHERE file_path = $1",[battleDetails.rows[0].artist1_trackpath]);
      const user2time = await db.query("SELECT upload_date FROM files WHERE file_path = $1",[battleDetails.rows[0].artist2_trackpath])
      const time1 = new Date(user1time.rows[0].upload_date);
      const time2 = new Date(user2time.rows[0].upload_date);
      startClock =  time1 > time2 ? time1 : time2;
      console.log(startClock);
    }


    console.log(username1);
    
    
    // Render the arena.ejs file and pass the battle data
    res.render("arena", {
      battleData: battleData.rows[0],
      username1,
      username2,
      currentUserId,
      setClock,
      startClock,
      battleDetails: battleDetails.rows[0],
    });
  } catch (error) {
    console.error("Error loading arena:", error);
    res.render("arena", {
      battleData: null,
      error: "Failed to load the arena.",
    });
  }
});

app.post("/uploadBattleFile/:battle_id/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  const battle_id = req.params.battle_id;

  try {
    const response = await axios.post(`${API_URL}/api/uploadFile/:userId`, {
      user_id,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
  }
});

app.post("/arena/vote/:battleId", async (req, res) => {
  const votedFor = req.body.votedFor; // The user ID being voted for
  const battleId = req.params.battleId;
  const currentUserId = req.session.userId; // Current user's ID
  console.log(`votedFor ${votedFor}`);
  try {
    // Check if the user has already voted in this battle
    const existingVote = await db.query(
      "SELECT * FROM votes WHERE battle_id = $1 AND user_id = $2",
      [battleId, currentUserId]
    );

    if (existingVote.rows.length > 0) {
      // User has already voted, return an error
      return res
        .status(400)
        .json({ error: "You have already voted in this battle." });
    }

    // If not, insert the new vote
    await db.query(
      "INSERT INTO votes (battle_id, user_id, voted_for) VALUES ($1, $2, $3)",
      [battleId, currentUserId, votedFor]
    );

    // Get current vote counts
    const response = await db.query(
      "SELECT * FROM battle_messages WHERE id = $1",
      [battleId]
    );
    const user1 = response.rows[0].user_id;
    const user2 = response.rows[0].challenger_id;
    console.log(user1);
    console.log(user2);

    let user1Votes = 0;
    let user2Votes = 0;

    if (votedFor == user1) {
      await db.query(
        "UPDATE battles SET user1_votes = user1_votes + 1 WHERE battle_id = $1",
        [battleId]
      );
      user1Votes++;
    } else if (votedFor == user2) {
      await db.query(
        "UPDATE battles SET user2_votes = user2_votes + 1 WHERE battle_id = $1",
        [battleId]
      );
      user2Votes++;
    } else {
      // Handle the case where the votedFor is invalid
      return res.status(400).json({ error: "Invalid vote." });
    }

    // Retrieve updated vote counts
    const updatedCounts = await db.query(
      "SELECT user1_votes, user2_votes FROM battles WHERE battle_id = $1",
      [battleId]
    );
    user1Votes += updatedCounts.rows[0].user1_votes;
    user2Votes += updatedCounts.rows[0].user2_votes;
    console.log(user1Votes);
    console.log(user2Votes);
    // Respond with the updated vote counts
    const result = {
      success: true,
      votes: [
        user1Votes,
        user2Votes,
      ],
    }
    console.log(result);
    res.json({
      success: true,
      votes: [
        user1Votes,
        user2Votes,
      ],
    });
  } catch (error) {
    console.error("Error recording vote:", error);
    res.status(500).json({ error: "Failed to record your vote." });
  }
});

app.post("/arena/update-status/:battleId", async (req, res) => {
  const battleId = req.params.battleId;
  const username = req.body.username;
  await db.query(
    "UPDATE battle_messages SET status = 'completed' WHERE id = $1",
    [battleId]
  );
  await db.query("UPDATE user_webster SET points = points + 1 WHERE username = $1",[username]);
  res.redirect(`/arena/${battleId}`);
});

app.get('/battle/votes/:battleId', async (req, res) => {
  const { battleId } = req.params;

  try {
    const battleDetails = await getBattleDetails(battleId); // Assume this retrieves the current vote counts
    res.json({
      user1_votes: battleDetails.user1_votes,
      user2_votes: battleDetails.user2_votes
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve votes' });
  }
});

app.get("/logout", (req, res) => {
  res.redirect("/");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
