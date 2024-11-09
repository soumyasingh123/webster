import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import path from "path";

const app = express();
const port = 7000;
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));


const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "webster",
    password: "mycreations",
    port: 5432,
  });
  
  db.connect().catch((err) => console.error("Connection error", err.stack));
  
  app.get("/portfolio/:userId",async(req,res)=>{
           const userId = req.params.userId;
           const userDetailsresult = await db.query("SELECT * FROM user_webster WHERE id = $1",[userId]);
           const userDetails = userDetailsresult.rows[0];
           res.render("portfolio",{userDetails});
  });
  app.listen(port, () => {
    console.log(`API server running on http://localhost:${port}`);
  });

