import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import path from "path";

const app = express();
const port = 5000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(cors({
  origin: 'http://localhost:3000', 
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true 
}));

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "webster",
    password: "mycreations",
    port: 5432,
  });
  
  db.connect().catch((err) => console.error("Connection error", err.stack));
  
  app.get("/profile/:userId",async(req,res)=>{
           const userId = req.params.userId;
           const userDetailsresult = await db.query("SELECT * FROM user_webster WHERE id = $1",[userId]);
           const userDetails = userDetailsresult.rows[0];
           res.render("profile",{userDetails});
  });


function getUserFolderPath(userId) {
    return `./public/uploads/${userId}`;
  }
  