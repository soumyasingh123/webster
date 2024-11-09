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
  
  const validateUserId = (req, res, next) => {
    const userId = req.params.userId;
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid or missing User ID" });
    }
    next();
  };
  
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, './public');
    },
    filename: (req, file, cb) => {
      cb(null,file.originalname);
    }
  });
  const upload = multer({ storage });
  
  // Handle file upload

  
  // Serve uploaded files
  app.use('/uploads', express.static('uploads'));
  

  
app.listen(port, () => {
    console.log(`API server running on http://localhost:${port}`);
  });