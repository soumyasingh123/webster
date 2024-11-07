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
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import env from "dotenv";

const app = express();
const port = 3000;
const API_URL = "http://localhost:4000";
const API2_URL = "http://localhost:5000";
const saltRounds = 10;
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized: true,
    cookie :{
      maxAge:1000*60*60*24
    }
  })
);

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());


const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password:  process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
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

app.get("/auth/google",passport.authenticate("google",{
  scope:["profile","email"],

}));

app.get(
  "/auth/google/rapBattles",
  passport.authenticate("google", {
    successRedirect: "/explore",
    failureRedirect: "/login",
  })
);
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // Check if the email or username already exists
    const checkEmail = await db.query("SELECT * FROM user_webster WHERE email = $1", [email]);
    const checkUsername = await db.query("SELECT * FROM user_webster WHERE username = $1", [username]);

    if (checkEmail.rows.length > 0) {
      return res.render("register", { error: "Email already exists. Try logging in." });
    } else if (checkUsername.rows.length > 0) {
      return res.render("register", { error: "Username already exists. Try something else." });
    } else if (password.length < 8) {
      return res.render("register", { error: "Password should have at least 8 characters." });
    }

    // Hash the password
    const hash = await bcrypt.hash(password, saltRounds);

    // Insert the new user into the database
    const insertResult = await db.query(
      "INSERT INTO user_webster (username, email, password) VALUES ($1, $2, $3) RETURNING *",
      [username, email, hash]
    );
    const userResult = insertResult.rows[0];

    // Set session userId for the user
    req.user.id = userResult.id;

    // Log the user in with Passport.js
    req.login(userResult, (err) => {
      if (err) {
        console.error("Error logging in:", err);
        return res.render("register", { error: "Login error after registration." });
      }
      console.log("Registration successful, user logged in.");
      return res.redirect("/explore");
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.render("register", { error: "An error occurred. Please try again." });
  }
});



app.post("/login", passport.authenticate("local",{
   successRedirect: "/explore",
   failureRedirect: "/login",
}));

app.get("/explore", async (req, res) => {
if(req.isAuthenticated()){
  try {
    const filesQuery = `
          SELECT file_id, file_name, file_path, like_count, dislike_count, upload_date
          FROM files
          ORDER BY upload_date DESC
      `;
    const filesResult = await db.query(filesQuery);
    console.log(req.user.id);
    res.render("explore", {
      allFiles: filesResult.rows,
      userId: req.user.id, // assuming you set userId in the session
    });
  } catch (error) {
    console.error("Error retrieving files:", error);
    res.status(500).json({ message: "Internal server error" });
  }
} else{
  res.redirect("/login");
}
});

app.get("/uploadFile", (req, res) => {
  res.redirect("/userFiles");
});

app.get("/userFiles", async (req, res) => {
  const userId = req.user.id;
  if (!userId) {
    console.log("user id missing");
    return res.redirect("/login");}

  try {
    const response = await axios.get(`${API_URL}/api/userFiles/${userId}`,{withCredentials:true});
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
    const user_id = req.user.id;
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
  const userId = req.user.id;
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
  const currentUserId = req.user.id;
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
      const user1time = await db.query(
        "SELECT upload_date FROM files WHERE file_path = $1",
        [battleDetails.rows[0].artist1_trackpath]
      );
      const user2time = await db.query(
        "SELECT upload_date FROM files WHERE file_path = $1",
        [battleDetails.rows[0].artist2_trackpath]
      );
      const time1 = new Date(user1time.rows[0].upload_date);
      const time2 = new Date(user2time.rows[0].upload_date);
      startClock = time1 > time2 ? time1 : time2;
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
    const response = await axios.post(`${API_URL}/api/uploadFile/${user_id}`, {
      user_id,
    },{withCredentials:true});
  } catch (error) {
    console.error("Error uploading file:", error);
  }
});


app.post("/arena/vote/:battleId", async (req, res) => {
  const votedFor = req.body.votedFor; // The user ID being voted for
  const battleId = req.params.battleId;
  const currentUserId = req.user.id; // Current user's ID
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
      votes: [user1Votes, user2Votes],
    };
    console.log(result);
    res.json({
      success: true,
      votes: [user1Votes, user2Votes],
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
  await db.query(
    "UPDATE user_webster SET points = points + 1 WHERE username = $1",
    [username]
  );
  res.redirect(`/arena/${battleId}`);
});

app.get("/battle/votes/:battleId", async (req, res) => {
  const { battleId } = req.params;

  try {
    const battleDetails = await getBattleDetails(battleId); // Assume this retrieves the current vote counts
    res.json({
      user1_votes: battleDetails.user1_votes,
      user2_votes: battleDetails.user2_votes,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve votes" });
  }
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});


passport.use(
  new Strategy(async function verify(username,password,cb) {
     try{
      const result = await db.query("SELECT * FROM user_webster WHERE username = $1",[username]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const hashedPassword = user.password;
  
        bcrypt.compare(password, hashedPassword, (err, result) => {
          if (err) {
            console.error("error comparing passswords : ", err);
            return cb(err);
          } else {
            if (result) {
              //passed password check
              console.log(user);
              return cb(null,user);
              
            } else {
              //didn't pass password check
              return cb(null,false);
            }
          }
        });
       
      } else {
         return cb("user not found");
      }
     }catch(err){
       console.log(err);
     }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/rapBattles",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      console.log(profile);
      try {
        const result = await db.query("SELECT * FROM user_webster WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO user_webster (username,email, password) VALUES ($1, $2,$3) RETURNING *",
            [profile.given_name , profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id); // Only store the user ID
});

// Deserialize the user (fetch the user object from the database based on the ID stored in the session)
passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM user_webster WHERE id = $1', [id]);
    if (result.rows.length > 0) {
      done(null, result.rows[0]); // Pass the full user object
    } else {
      done(new Error('User not found'));
    }
  } catch (err) {
    done(err);
  }
});



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
