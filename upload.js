import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer";
import fs from "fs";
import path from "path";
import session from "express-session";
import cors from 'cors';

const app = express();
const port = 4000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(cors({
  origin: 'http://localhost:3000', 
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true 
}));


const validateUserId = (req, res, next) => {
  const userId = req.params.userId;
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ message: "Invalid or missing User ID" });
  }
  next();
};

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "webster",
  password: "mycreations",
  port: 5432,
});

db.connect().catch((err) => console.error("Connection error", err.stack));


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.params.userId;
    const folderPath = getUserFolderPath(userId);
    createUserFolder(userId);
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const maxSize = 10 * 1000 * 1000; 
const upload = multer({
  storage: storage,
  limits: { fileSize: maxSize },
  fileFilter: function (req, file, cb) {
    const allowedFileTypes = /mp3|wav|pdf|jpg|docx/;
    const mimeType = file.mimetype === 'audio/mpeg' || allowedFileTypes.test(file.mimetype);
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimeType && extname) {
      cb(null, true);
    } else {
      cb(new Error("File upload only supports audio and document file types."));
    }
  }
}).single("myfile");




app.get("/api/userFiles/:userId", validateUserId, (req, res) => {
  const userId = req.params.userId;
  const userFolder = path.join("./public/uploads", userId.toString());

  fs.readdir(userFolder, (err, files) => {
    if (err) {
      console.error("Error reading user files:", err);
      return res.status(500).json({ message: "Error reading files", files: [] });
    }
    res.json({ files, userId });
  });
});


app.post("/api/uploadFile/:battleId/:userId", validateUserId, async (req, res) => {
  const { userId, battleId } = req.params;

  try {
    // Handle file upload
    await new Promise((resolve, reject) => {
      upload(req, res, function (err) {
        if (err) {
          return reject(new Error(err.message));
        } else if (!req.file) {
          return reject(new Error("No file selected."));
        } else {
          resolve();
        }
      });
    });

    const fileName = req.file.originalname;
    const filePath = path.join(`/uploads/${userId}`, fileName);
    const uploadDate = new Date();

    // Insert file into `files` table
    const insertQuery = `
      INSERT INTO files (file_name, file_path, like_count, dislike_count, upload_date, user_id)
      VALUES ($1, $2, 0, 0, $3, $4)
      RETURNING file_id
    `;
    const result = await db.query(insertQuery, [fileName, filePath, uploadDate, userId]);
    const fileId = result.rows[0].file_id;

    // Fetch the battle record to check user roles
    const battle = await db.query("SELECT * FROM battle_messages WHERE id = $1", [battleId]);
    if (battle.rows.length === 0) {
      throw new Error("Battle not found.");
    }

    const battleRecord = battle.rows[0];
    console.log(userId);
    let trackPathColumn;

    // Determine correct trackpath column based on user role
    if (userId == battleRecord.user_id) {
      trackPathColumn = "artist1_trackpath";
    } else if (userId == battleRecord.challenger_id) {
      trackPathColumn = "artist2_trackpath";
    } else {
      throw new Error("User is not part of this battle.");
    }

    // Update battle_messages with the file path
    const updateBattleQuery = `
      UPDATE battles
      SET ${trackPathColumn} = $1
      WHERE battle_id = $2
    `;
    await db.query(updateBattleQuery, [filePath, battleId]);

    console.log(`File uploaded successfully with file ID: ${fileId}. Path added to ${trackPathColumn} in battle_messages.`);

    res.redirect(`http://localhost:3000/arena/${battleId}`);
  } catch (error) {
    console.error("File upload error:", error.message);
    res.status(400).json({ message: error.message });
  }
});



// Route to delete a specific file for a user
app.delete("/api/userFiles/:userId/:fileName", validateUserId, async (req, res) => {
  const { userId, fileName } = req.params;
  const filePath = path.join(`./public/uploads/${userId}`, fileName);

  try {
    // First, check if the file exists in the database
    const queryText = `SELECT file_id FROM files WHERE file_name = $1 AND user_id = $2`;
    const result = await db.query(queryText, [fileName, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "File not found in database" });
    }

    // Delete the physical file
    fs.unlink(filePath, async (err) => {
      if (err) {
        console.error("Error deleting file:", err);
        return res.status(500).json({ message: "Error deleting file" });
      }

      // If file deletion succeeds, delete the record from the database
      const deleteQuery = `DELETE FROM files WHERE file_name = $1 AND user_id = $2`;
      await db.query(deleteQuery, [fileName, userId]);

      res.json({ message: "File deleted successfully from server and database" });
    });
  } catch (error) {
    console.error("Error during file deletion:", error);
    res.status(500).json({ message: "Error deleting file" });
  }
});



function getUserFolderPath(userId) {
  return `./public/uploads/${userId}`;
}

function createUserFolder(userId) {
  const folderPath = getUserFolderPath(userId);
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      console.log("Folder created successfully:", folderPath);
    }
  } catch (err) {
    console.error("Error creating folder:", err);
  }
}



app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});


