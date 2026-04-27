const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ================= DB CONNECTION =================
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'hostel',
});

db.connect(err => {
  if (err) console.log("DB Connection Failed ❌", err);
  else console.log("MySQL Connected ✔");
});



//----------------------------------
const assignRoomToStudent = (hostel_id, student_id, callback) => {
  // 1️⃣ Find rooms in this hostel that are not full
  const sql = `
    SELECT r.room_id, r.room_no, r.capacity, COUNT(s.student_id) AS occupants
    FROM rooms r
    LEFT JOIN student s ON r.room_id = s.room_id
    WHERE r.hostel_id = ?
    GROUP BY r.room_id
    HAVING occupants < r.capacity
    ORDER BY r.room_no ASC
    LIMIT 1
  `;

  db.query(sql, [hostel_id], (err, result) => {
    if (err) return callback(err);

    if (result.length > 0) {
      // Room found with vacancy
      return callback(null, result[0].room_id);
    }  else {
  // No room available
  return callback(null, null); // frontend can handle "no vacancy"
}
  });
};
// ================= MULTER SETUP =================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "_" + file.originalname);
  }
});
const upload = multer({ storage: storage });

// ======================================
// UPLOAD STUDENTS CSV/EXCEL (FINAL)
// ======================================

app.post("/upload-students", upload.single("file"), (req, res) => {
  console.log("API HIT");

  if (!req.file) {
    return res.json({ success: false, message: "No file uploaded" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    console.log("ROWS:", rows);

    if (rows.length === 0) {
      return res.json({ success: false, message: "Excel file is empty" });
    }

    // ================= FETCH COURSES =================
    db.query("SELECT course_id, course_name, course_year FROM course", (err, courses) => {
      if (err) {
        console.log("Course error:", err);
        return res.json({ success: false, message: err.message });
      }

      // ✅ Create course map
      const courseMap = {};
      courses.forEach(c => {
        const key = `${c.course_name.trim().toLowerCase()}-${c.course_year}`;
        courseMap[key] = c.course_id;
      });

      const values = [];

      // ================= PROCESS ROWS =================
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        // ✅ Safe course parsing
        let courseStr = (r.course || "").trim().replace(/\s+/g, " ");
        const parts = courseStr.split(" ");

        let course_name = parts[0];
        let course_year = parseInt(parts[1]);

        if (!course_name || isNaN(course_year)) {
          return res.json({
            success: false,
            message: `Invalid course format '${r.course}' at row ${i + 2}`
          });
        }

        const key = `${course_name.toLowerCase()}-${course_year}`;
        const courseId = courseMap[key];

        if (!courseId) {
          return res.json({
            success: false,
            message: `Course '${course_name} ${course_year}' not found at row ${i + 2}`
          });
        }

        values.push([
          r.student_name || r.name || "",
          r.password || "",
          r.student_email || "",
          courseId,
          r.session || "",
          r.roomID || null
        ]);
      }

      if (values.length === 0) {
        return res.json({ success: false, message: "No valid data to insert" });
      }

      // ================= INSERT =================
      const insertSql = `
        INSERT INTO student
        (name, password, student_email, course_id, session, room_id)
        VALUES ?
      `;

      db.query(insertSql, [values], (err, result) => {
        if (err) {
          console.log("Insert error:", err);
          return res.json({ success: false, message: err.message });
        }

        console.log("Inserted rows:", result.affectedRows);

        // ================= FETCH INSERTED DATA =================
        const fetchSql = `
          SELECT s.student_id, s.name, s.student_email, s.session, s.room_id,
                 c.course_name, c.course_year
          FROM student s
          JOIN course c ON s.course_id = c.course_id
          ORDER BY s.student_id DESC
          LIMIT ?
        `;

        db.query(fetchSql, [result.affectedRows], (err2, students) => {
          if (err2) {
            console.log("Fetch error:", err2);
            return res.json({
              success: true,
              message: "Uploaded but fetch failed"
            });
          }

          res.json({
            success: true,
            message: `${result.affectedRows} students uploaded successfully`,
            data: students   // ✅ IMPORTANT FOR UI
          });
        });
      });
    });

  } catch (error) {
    console.log("CRASH:", error);
    res.json({ success: false, message: error.message });
  }
});
// ======================================
// UPLOAD WARDENS (ONLY BASIC DATA)
// ======================================
app.post("/upload-wardens", upload.single("file"), (req, res) => {
  console.log("WARDEN API HIT");

  if (!req.file) {
    return res.json({ success: false, message: "No file uploaded" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    console.log("ROWS:", rows);

    const values = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // ✅ validation
      if (!r.name || !r.email || !r.password) {
        return res.json({
          success: false,
          message: `Missing data at row ${i + 1}`
        });
      }

      values.push([
        r.name,
        r.email,
        r.password
      ]);
    }

    const sql = `
      INSERT INTO warden (name, email, password)
      VALUES ?
    `;

    db.query(sql, [values], (err, result) => {
      if (err) {
        console.log("Insert error:", err);
        return res.json({ success: false, message: err.message });
      }

      res.json({
        success: true,
        message: `${result.affectedRows} wardens uploaded successfully`,
        data: rows
      });
    });

  } catch (error) {
    console.log("CRASH:", error);
    res.json({ success: false, message: error.message });
  }
});
// ================= GET COURSES =================
app.get("/admin/courses", (req, res) => {

  const sql = `
  SELECT 
    course_id,
    CONCAT(course_name,' (',course_year,')') AS course_label
  FROM course
  ORDER BY course_name
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.log("Course fetch error:", err);
      return res.json([]);
    }

    res.json(result || []);

  });

});
// ================= ADD COURSE (with duplicate check) =================
app.post("/admin/add-course", (req, res) => {
  const { course_name, course_year } = req.body;

  if (!course_name || !course_year) {
    return res.json({
      success: false,
      message: "Course name and year are required"
    });
  }

  // Step 1: Check if course already exists
  const checkSql = `
    SELECT * FROM course
    WHERE course_name = ? AND course_year = ?
  `;

  db.query(checkSql, [course_name.trim(), course_year], (err, result) => {
    if (err) {
      console.log("Course check error:", err);
      return res.json({ success: false, message: "Database error" });
    }

    if (result.length > 0) {
      return res.json({
        success: false,
        message: "This course already exists!"
      });
    }

    // Step 2: Insert new course
    const insertSql = `
      INSERT INTO course (course_name, course_year)
      VALUES (?, ?)
    `;

    db.query(insertSql, [course_name.trim(), course_year], (err2) => {
      if (err2) {
        console.log("Course insert error:", err2);
        return res.json({ success: false, message: "Insert failed" });
      }

      res.json({ success: true, message: "Course added successfully" });
    });
  });
});

// ================= GET HOSTELS =================
app.get("/hostels", (req, res) => {
  const sql = `SELECT * FROM hostel1 ORDER BY hostel_name`;
  db.query(sql, (err, result) => {
    if (err) return res.json([]);
    res.json(result);
  });
});
// ======================================
// ADMIN - GET ALL HOSTELS
// ======================================
app.get("/admin/hostels", (req, res) => {

  const sql = `
  SELECT hostel_id, hostel_name
  FROM hostel1
  ORDER BY hostel_name
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.log("Hostel fetch error:", err);
      return res.json([]);
    }

    res.json(result || []);

  });

});
// ======================================
// ADMIN - GET ALL WARDENS
// ======================================
app.get("/admin/wardens", (req, res) => {
  const sql = `SELECT warden_id, name FROM warden ORDER BY name`;

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Warden fetch error:", err);
      return res.json([]);
    }

    res.json(result);
  });
});

// ================= LOGIN (NON-ADMIN USERS) =================
app.post('/login', (req, res) => {
  const { email, password, role } = req.body;

  console.log("LOGIN REQUEST:", email, role);

  let sql = "";
  let values = [email, password];

  if (role === "student") {
    sql = `
      SELECT name, student_email AS email
      FROM student
      WHERE student_email = ? AND password = ?
    `;
  } 
  else if (role === "warden") {
    sql = `
      SELECT name, email
      FROM warden
      WHERE email = ? AND password = ?
    `;
  } 
  else if (role === "maintenance_department") {
    sql = `
      SELECT name, email
      FROM maintenance
      WHERE email = ? AND password = ?
    `;
  } 
  else {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("SQL ERROR:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }

    if (result.length === 0) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    res.json({
      success: true,
      role,
      email: result[0].email,
      name: result[0].name || "User"
    });
  });
});
// ================= ADMIN LOGIN =================
app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;

  const sql = `
    SELECT email
    FROM admin
    WHERE email = ? AND password = ?
  `;

  db.query(sql, [email, password], (err, result) => {
    if (err) {
      console.log("Admin login error:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (result.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({
      email: result[0].email,
      name: "Admin"
    });
  });
});
// =================================================
// STUDENT DASHBOARD DATA (Hostel + Room + Complaints)
// =================================================
app.get('/student-data', (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  // 1️⃣ Get hostel + room of student
  const sql = `
SELECT 
  h.hostel_name,
  r.room_no,
  s.student_id
FROM student s
LEFT JOIN course_hostel ch ON s.course_id = ch.course_id
LEFT JOIN hostel1 h ON ch.hostel_id = h.hostel_id
LEFT JOIN rooms r ON s.room_id = r.room_id
WHERE s.student_email = ?
`;
  db.query(sql, [email], (err, result) => {
    if (err || result.length === 0) {
      return res.json({
        hostelname: null,
        room_no: null,
        complaints: []
      });
    }

    const hostelname = result[0].hostel_name;
    const room_no = result[0].room_no;
    const student_id = result[0].student_id;

    // 2️⃣ Fetch complaints using student_id (normalized way)
    const complaintSql = `
      SELECT *
      FROM complaints
      WHERE student_id = ?
      ORDER BY created_at DESC
    `;

    db.query(complaintSql, [student_id], (err2, complaints) => {
      if (err2) complaints = [];

      res.json({
        hostelname,
        room_no,
        complaints
      });
    });
  });
});
// ================= ADD CATEGORY =================
app.post("/categories", (req, res) => {
  const { category_name } = req.body;

  if (!category_name || !category_name.trim()) {
    return res.json({
      success: false,
      message: "Category name is required"
    });
  }

  // ✅ CHECK DUPLICATE
  const checkSql = `
    SELECT * FROM complaint_categories 
    WHERE LOWER(category_name) = LOWER(?)
  `;

  db.query(checkSql, [category_name.trim()], (err, result) => {
    if (err) {
      console.log("Check error:", err);
      return res.json({ success: false, message: err.message });
    }

    if (result.length > 0) {
      return res.json({
        success: false,
        message: "Category already exists"
      });
    }

    // ✅ INSERT
    const insertSql = `
      INSERT INTO complaint_categories (category_name)
      VALUES (?)
    `;

    db.query(insertSql, [category_name.trim()], (err2) => {
      if (err2) {
        console.log("Insert error:", err2);
        return res.json({ success: false, message: err2.message });
      }

      res.json({
        success: true,
        message: "Category added successfully"
      });
    });
  });
});
// =================================================
// GET CATEGORIES
// =================================================
app.get("/categories", (req, res) => {
  const sql = `
    SELECT id, category_name 
    FROM complaint_categories 
    ORDER BY category_name
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Category fetch error:", err);
      return res.json([]);
    }
    res.json(result);
  });
});


// ======================================
// WARDEN-SPECIFIC MESS MENU REPORT WITH RANGE
// ======================================
app.get("/reports/messmenu/warden/:email", (req, res) => {
  const { email } = req.params;
  const range = req.query.range || "weekly"; // default weekly

  // 1️⃣ Get warden's hostel(s)
  const hostelSql = `
    SELECT DISTINCT wh.hostel_id, h.hostel_name
    FROM warden w
    JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    JOIN hostel1 h ON wh.hostel_id = h.hostel_id
    WHERE w.email = ?
  `;

  db.query(hostelSql, [email], (err, hostels) => {
    if (err || hostels.length === 0) {
      return res.json({ data: [], stats: { total: 0, breakfast: 0, lunch: 0, dinner: 0, snacks: 0 } });
    }

    const hostelIds = hostels.map(h => h.hostel_id);
    const placeholders = hostelIds.map(() => "?").join(",");

    // 2️⃣ Filter by range
    let dateCondition = "";
    if (range === "weekly") {
      dateCondition = "AND m.menu_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
    } else if (range === "monthly") {
      dateCondition = "AND MONTH(m.menu_date) = MONTH(CURDATE()) AND YEAR(m.menu_date) = YEAR(CURDATE())";
    } else if (range === "yearly") {
      dateCondition = "AND YEAR(m.menu_date) = YEAR(CURDATE())";
    }

    // 3️⃣ Mess menu query
    const sql = `
      SELECT 
        m.id,
        m.hostel_id,
        h.hostel_name,
        m.menu_date,
        m.meal_type,
        GROUP_CONCAT(f.food_name SEPARATOR ', ') AS food_items,
        COUNT(mi.food_id) AS food_count
      FROM mess_menu m
      LEFT JOIN mess_menu_items mi ON m.id = mi.mess_menu_id
      LEFT JOIN food_items f ON mi.food_id = f.id
      JOIN hostel1 h ON m.hostel_id = h.hostel_id
      WHERE m.hostel_id IN (${placeholders}) ${dateCondition}
      GROUP BY m.id, m.hostel_id, m.menu_date, m.meal_type, h.hostel_name
      ORDER BY m.menu_date DESC, m.meal_type ASC
    `;

    db.query(sql, hostelIds, (err2, results) => {
      if (err2) {
        console.error("Warden mess menu error:", err2);
        return res.status(500).json({ data: [], stats: { total: 0, breakfast: 0, lunch: 0, dinner: 0, snacks: 0 } });
      }

      // Stats calculation
      const total = results.length;
      const stats = {
        total,
        breakfast: results.filter(r => r.meal_type?.toLowerCase() === "breakfast").length,
        lunch: results.filter(r => r.meal_type?.toLowerCase() === "lunch").length,
        dinner: results.filter(r => r.meal_type?.toLowerCase() === "dinner").length,
        snacks: results.filter(r => r.meal_type?.toLowerCase() === "snacks").length,
      };

      res.json({ data: results, stats });
    });
  });
});
// =================================================
// ADD COMPLAINT (NORMALIZED VERSION)
// =================================================
app.post('/complaints', (req, res) => {
  const { email, category, title, description, priority } = req.body;

  if (!email || !category || !title || !description) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields"
    });
  }

  // 🔥 EXTRA VALIDATION
  if (isNaN(parseInt(category))) {
    return res.status(400).json({
      success: false,
      message: "Invalid category"
    });
  }

  // 1️⃣ Get student + room_id
  const studentSql = `
    SELECT 
      s.student_id,
      s.room_id
    FROM student s
    WHERE s.student_email = ?
  `;

  db.query(studentSql, [email], (err, result) => {

    if (err || result.length === 0) {
      console.log("Student fetch error:", err);
      return res.status(400).json({
        success: false,
        message: "Student not found"
      });
    }

    const student_id = result[0].student_id;
    const room_id = result[0].room_id; // ✅ FIX

    const finalPriority =
      priority && ["low", "medium", "high"].includes(priority)
        ? priority
        : "medium";

    // 2️⃣ Insert complaint
    const insertSql = `
      INSERT INTO complaints
      (student_id, room_id, category_id, title, description, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    db.query(insertSql, [
      student_id,
      room_id,                 // ✅ FIX
      parseInt(category),
      title,
      description,
      finalPriority
    ], (err2) => {

      if (err2) {
        console.log("INSERT ERROR:", err2); // 👈 check this if error
        return res.status(500).json({
          success: false,
          message: "Database insert failed"
        });
      }

      res.json({ success: true });
    });
  });
});

// ================= ALL COMPLAINTS =================
app.get("/reports/complaints/all", (req, res) => {
  const { type } = req.query;

  let dateFilter = "";

  if (type === "weekly") dateFilter = "WHERE c.created_at >= NOW() - INTERVAL 7 DAY";
  else if (type === "monthly") dateFilter = "WHERE c.created_at >= NOW() - INTERVAL 30 DAY";

  const query = `
    SELECT 
      c.id,
     c.student_id 
      c.title,
      c.description,
      c.warden_note,
      c.priority,
      c.status,
      c.created_at,
      cc.category_name AS category
    FROM complaints c
    JOIN complaint_categories cc ON c.category_id = cc.category_id
    ${dateFilter}
    ORDER BY c.created_at DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }

    // Stats calculation
    let resolved = 0, pending = 0, inprogress = 0;

    results.forEach(c => {
      const status = c.status.toLowerCase();
      if (status === "resolved") resolved++;
      else if (status === "pending") pending++;
      else if (status === "in-progress") inprogress++;
    });

    res.json({
      complaints: results,
      stats: { resolved, pending, inprogress }
    });
  });
});
// =================================================
// MAINTENANCE - GET COMPLAINTS WITH FILTERS (FIXED)
// =================================================
app.get("/complaints/municipal", (req, res) => {
  const { category, status, hostel, date } = req.query;

  let sql = `
    SELECT 
      c.id,
      h.hostel_name,
      r.room_no,
      c.title,
      c.description,
      c.status,
      c.created_at,
      cc.category_name
    FROM complaints c
    JOIN student s ON c.student_id = s.student_id
    LEFT JOIN rooms r ON c.room_id = r.room_id
    LEFT JOIN hostel1 h ON r.hostel_id = h.hostel_id
    JOIN complaint_categories cc ON c.category_id = cc.id
    WHERE 1=1
  `;

  const params = [];

  // Category filter
  if (category && category !== "all") {
    sql += " AND c.category_id = ?";
    params.push(parseInt(category));
  }

  // Status filter
  if (status && status !== "all") {
    sql += " AND c.status = ?";
    params.push(status);
  }

  // Hostel filter
  if (hostel && hostel !== "") {
    sql += " AND h.hostel_name = ?";
    params.push(hostel);
  }

  // Date filter
  if (date) {
    sql += " AND DATE(c.created_at) = ?";
    params.push(date);
  }

  sql += " ORDER BY c.created_at DESC";

  db.query(sql, params, (err, result) => {
    if (err) {
      console.log("❌ Municipal complaints fetch error:", err);
      return res.json([]);
    }

    res.json(result);
  });
});
app.get('/complaints/student/:email', (req, res) => {

  const { email } = req.params;

  const sql = `
    SELECT 
      c.id,
      h.hostel_name,
      r.room_no,
      c.title,
      c.description,
      c.status,
      c.priority,
      c.created_at,
      DATEDIFF(CURDATE(), c.created_at) AS pending_days
    FROM complaints c
    INNER JOIN student s ON c.student_id = s.student_id
    LEFT JOIN hostel1 h ON h.hostel_id = (
      SELECT ch.hostel_id 
      FROM course_hostel ch 
      WHERE ch.course_id = s.course_id 
      LIMIT 1
    )
    LEFT JOIN rooms r ON s.room_id = r.room_id
    WHERE s.student_email = ?
    ORDER BY c.created_at DESC
  `;

  db.query(sql, [email], (err, result) => {
    if (err) {
      console.log("Fetch complaint error:", err);
      return res.json([]);
    }

    res.json(result);
  });
});
//-------delete complaint by student------------
app.delete("/complaints/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM complaints WHERE id=? AND status='pending'";

  db.query(sql, [id], (err, result) => {

    if (err) {
      console.error(err);
      return res.json({
        success: false,
        message: "Database error"
      });
    }

    if (result.affectedRows === 0) {
      return res.json({
        success: false,
        message: "Complaint cannot be deleted after it is in-progress"
      });
    }

    res.json({
      success: true,
      message: "Complaint deleted successfully"
    });

  });
});
//-------update complaint by student------------
app.put("/complaints/:id", (req, res) => {
  const { id } = req.params;
  const { title, description, priority } = req.body;

  const sql = `
    UPDATE complaints
    SET title=?, description=?, priority=?
    WHERE id=? AND status='pending'
  `;

  db.query(sql, [title, description, priority, id], (err, result) => {

    if (err) {
      console.error(err);
      return res.json({
        success: false,
        message: "Database error"
      });
    }

    if (result.affectedRows === 0) {
      return res.json({
        success: false,
        message: "Complaint cannot be updated after it is in-progress"
      });
    }

    res.json({
      success: true,
      message: "Complaint updated successfully"
    });

  });
});
// ======================================
// GET HOSTEL OF LOGGED IN WARDEN
// ======================================
app.get("/warden/hostel/:email", (req, res) => {
  const { email } = req.params;
  const sql = `
    SELECT h.hostel_name
    FROM warden w
    JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    JOIN hostel1 h ON wh.hostel_id = h.hostel_id
    WHERE w.email = ?
  `;
  db.query(sql, [email], (err, result) => {
    if (err || result.length === 0) return res.json({});
    res.json(result[0]);
  });
});
//////
app.get("/complaints/warden/:email", (req, res) => {
  const { email } = req.params;
  const { date, category, status } = req.query;

  // 1️⃣ Get warden hostel ids
  const hostelSql = `
    SELECT wh.hostel_id 
    FROM warden_hostel wh
    JOIN warden w ON wh.warden_id = w.warden_id
    WHERE w.email = ?
  `;

  db.query(hostelSql, [email], (err, hostels) => {
    if (err) {
      console.log(err);
      return res.status(500).json([]);
    }

    if (!hostels.length) return res.json([]);

    const hostelIds = hostels.map(h => h.hostel_id);
    const placeholders = hostelIds.map(() => "?").join(",");

    // 2️⃣ FIXED QUERY (IMPORTANT CHANGE HERE)
    let sql = `
      SELECT 
        c.id,
        c.title,
        c.description,
        c.status,
        c.created_at,
        c.warden_note,

        c.category_id,
        cc.category_name,

        c.room_id,
        r.room_no,

        s.student_id,
        s.name AS student_name,

        r.hostel_id

      FROM complaints c

      JOIN student s 
        ON c.student_id = s.student_id

      LEFT JOIN rooms r 
        ON c.room_id = r.room_id

      LEFT JOIN complaint_categories cc 
        ON c.category_id = cc.id

      WHERE r.hostel_id IN (${placeholders})
    `;

    const params = [...hostelIds];

    // ================= FILTERS =================

    if (date) {
      sql += " AND DATE(c.created_at) = ? ";
      params.push(date);
    }

    if (category && category !== "all") {
      sql += " AND c.category_id = ? ";
      params.push(parseInt(category));
    }

    if (status && status !== "all") {
      sql += " AND c.status = ? ";
      params.push(status);
    }

    sql += " ORDER BY c.created_at DESC";

    db.query(sql, params, (err2, results) => {
      if (err2) {
        console.log(err2);
        return res.status(500).json([]);
      }

      // 3️⃣ NORMALIZE DATA FOR FRONTEND
      const formatted = results.map(c => ({
        ...c,
        room_no: c.room_no || `Unassigned Room (${c.room_id})`,
        category_name: c.category_name || `Category ${c.category_id}`,
        status: c.status?.toLowerCase()
      }));

      res.json(formatted);
    });
  });
});
// ======================================
// WARDEN RESOLVE COMPLAINT WITH NOTE
// ======================================
app.put("/complaints/:id/resolve", (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  const sql = `
    UPDATE complaints
    SET status = 'resolved',
        warden_note = ?
    WHERE id = ?
  `;

  db.query(sql, [note, id], (err) => {
    if (err) {
      console.log("Resolve error:", err);
      return res.json({ success: false });
    }
    res.json({ success: true });
  });
});

// =================================================
// UPDATE COMPLAINT STATUS (UNIVERSAL)
// =================================================
app.put('/complaints/:id/status', (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  const sql = "UPDATE complaints SET status=? WHERE id=?";

  db.query(sql, [status, id], (err) => {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// =================================================
// ASSIGN HOSTEL TO COURSE (ADMIN)
// =================================================
app.post("/admin/assign-hostel", (req, res) => {

  const { hostel_id, course_id } = req.body;

  if (!hostel_id || !course_id) {
    return res.json({ success:false });
  }

  const checkSql = `
  SELECT * FROM course_hostel
  WHERE hostel_id=? AND course_id=?
  `;

  db.query(checkSql,[hostel_id,course_id],(err,result)=>{

    if(result.length>0){
      return res.json({ success:false, message:"Already assigned" });
    }

    const insertSql = `
    INSERT INTO course_hostel (hostel_id, course_id)
    VALUES (?,?)
    `;

    db.query(insertSql,[hostel_id,course_id],(err2)=>{
      if(err2){
        console.log("Assign error:",err2);
        return res.json({ success:false });
      }

      res.json({ success:true });
    });

  });

});
//////////////
app.delete("/admin/remove-assignment/:id", (req, res) => {

  const { id } = req.params;

  const sql = `
  DELETE FROM course_hostel
  WHERE id = ?
  `;

  db.query(sql, [id], (err) => {

    if (err) {
      console.log("Delete error:", err);
      return res.json({ success:false });
    }

    res.json({ success:true });

  });

});
// ======================================
// ADMIN - GET HOSTEL COURSE ASSIGNMENTS
// ======================================
app.get("/admin/hostel-course", (req, res) => {

  const sql = `
  SELECT 
    ch.id,
    h.hostel_name,
    CONCAT(c.course_name,' (',c.course_year,')') AS course_name
  FROM course_hostel ch
  JOIN hostel1 h ON ch.hostel_id = h.hostel_id
  JOIN course c ON ch.course_id = c.course_id
  ORDER BY h.hostel_name
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.log("Assignment fetch error:", err);
      return res.json([]);
    }

    res.json(result || []);

  });

});
// ======================================
// ADMIN - ADD HOSTEL (with duplicate check)
// ======================================
app.post("/admin/add-hostel", (req, res) => {

  const { hostel_name } = req.body;

  if (!hostel_name) {
    return res.json({ success: false, message: "Hostel name required" });
  }

  // Step 1: Check if hostel already exists
  const checkSql = `SELECT * FROM hostel1 WHERE hostel_name = ?`;
  db.query(checkSql, [hostel_name.trim()], (err, result) => {
    if (err) {
      console.log("Hostel check error:", err);
      return res.json({ success: false, message: "Database error" });
    }

    if (result.length > 0) {
      return res.json({ success: false, message: "This hostel already exists!" });
    }

    // Step 2: Insert new hostel
    const insertSql = `INSERT INTO hostel1 (hostel_name) VALUES (?)`;
    db.query(insertSql, [hostel_name.trim()], (err2) => {
      if (err2) {
        console.log("Hostel insert error:", err2);
        return res.json({ success: false, message: "Insert failed" });
      }

      res.json({ success: true, message: "Hostel added successfully" });
    });
  });

});
app.get("/warden/room-students/:hostel_id", (req, res) => {
  const { hostel_id } = req.params;

  const sql = `
    SELECT 
      s.student_id,
      s.name,
      s.student_email,
      r.room_no
    FROM student s
    JOIN rooms r ON s.room_id = r.room_id
    WHERE r.hostel_id = ?
    ORDER BY r.room_no
  `;

  db.query(sql, [hostel_id], (err, result) => {
    if (err) return res.json([]);
    res.json(result);
  });
});
// Get all warden-hostel assignments with names
// Get all warden-hostel assignments with names
app.get("/admin/warden-hostel-assignments", (req, res) => {
  const sql = `
    SELECT 
      wh.id,
      h.hostel_name,
      w.name AS warden_name
    FROM warden_hostel wh
    JOIN hostel1 h ON wh.hostel_id = h.hostel_id
    JOIN warden w ON wh.warden_id = w.warden_id
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log(err);
      return res.json([]);
    }
    res.json(result);
  });
});
// ======================================
// ADMIN - ASSIGN WARDEN TO HOSTEL
// ======================================
app.post("/admin/assign-warden-hostel", (req, res) => {
  const { hostel_id, warden_ids } = req.body;

  if (!hostel_id || !warden_ids || !Array.isArray(warden_ids) || warden_ids.length === 0) {
    return res.status(400).json({ success: false, message: "Hostel and wardens are required" });
  }

  const values = warden_ids.map(wid => [parseInt(wid), parseInt(hostel_id)]);

  const sql = `
    INSERT IGNORE INTO warden_hostel (warden_id, hostel_id)
    VALUES ?
  `;

  db.query(sql, [values], (err, result) => {
    if (err) {
      console.log("INSERT ERROR:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    res.json({ success: true, inserted: result.affectedRows });
  });
});
// ======================================
// GET ALL FOODS (WITH CATEGORY)
// ======================================
app.get("/foods", (req, res) => {
  const sql = `
    SELECT 
      f.id,
      f.food_name,
      f.category_id,
      fc.category_name
    FROM food_items f
    JOIN food_category fc ON f.category_id = fc.category_id
    ORDER BY fc.category_name, f.food_name
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Fetch foods error:", err);
      return res.json([]);
    }
    res.json(result);
  });
});

// ======================================
// ADD NEW FOOD WITH CATEGORY
// ======================================
app.post("/food", (req, res) => {
  console.log("👉 BODY RECEIVED:", req.body);

  const { food_name, category_id } = req.body;

  if (!food_name || !category_id) {
    return res.json({
      success: false,
      message: "food_name or category missing",
    });
  }

  const sql = `
    INSERT INTO food_items (food_name, category_id)
    VALUES (?, ?)
  `;

  db.query(sql, [food_name, category_id], (err, result) => {
    if (err) {
      console.log("❌ SQL ERROR:", err);
      return res.json({ success: false, error: err.message });
    }

    console.log("✅ Food inserted with category:", category_id);

    res.json({ success: true });
  });
});
// ================= update food items =================
 app.put("/food/:id", (req, res) => {
  const { id } = req.params;
  const { food_name, category_id } = req.body;

  const sql = `
    UPDATE food_items
    SET food_name = ?, category_id = ?
    WHERE id = ?
  `;

  db.query(sql, [food_name, category_id, id], (err) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true });
  });
});
// ======================================
// ADD NEW FOOD CATEGORY
// ======================================
app.post("/food-category", (req, res) => {
  const { category_name } = req.body;

  if (!category_name) {
    return res.json({ success: false, message: "Category name required" });
  }

  const sql = `INSERT INTO food_category (category_name) VALUES (?)`;

  db.query(sql, [category_name], (err, result) => {
    if (err) {
      console.log("Category insert error:", err);
      return res.json({ success: false, message: err.message });
    }

    res.json({ success: true, category_id: result.insertId });
  });
});
// ================= delete food items =================
app.delete("/food/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM food_items WHERE id = ?";

  db.query(sql, [id], (err) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true });
  });
});
// ======================================
// ADD OR UPDATE MESS MENU (HOSTEL WISE) - FIXED
// ======================================
app.post("/mess-menu", (req, res) => {
  const {
    email,
    menu_date,      // new date to save menu
    meal_type,      // Breakfast/Lunch/Dinner
    food_ids = [],  // selected food IDs
    copy_from_date, // optional date to copy from
  } = req.body;

  if (!email || !meal_type) {
    return res.json({ success: false, message: "Email and meal type are required" });
  }

  // Step 1: Get hostel_id for warden
  db.query(
    `SELECT wh.hostel_id
     FROM warden w
     JOIN warden_hostel wh ON w.warden_id = wh.warden_id
     WHERE w.email = ?`,
    [email],
    (err, result) => {
      if (err || !result.length)
        return res.json({ success: false, message: "Hostel not found" });

      const hostel_id = result[0].hostel_id;

      // Step 2: Determine which food IDs to use
      const getFinalFoodIds = (callback) => {
        if (copy_from_date) {
          // Copy from another date
          db.query(
            `SELECT mi.food_id
             FROM mess_menu m
             JOIN mess_menu_items mi ON m.id = mi.mess_menu_id
             WHERE m.menu_date = ? AND m.meal_type = ? AND m.hostel_id = ?`,
            [copy_from_date, meal_type, hostel_id],
            (errCopy, results) => {
              if (errCopy) return callback([]);
              // If no results and manual food_ids provided, use manual selection
              const ids = results.length ? results.map(r => r.food_id) : food_ids.map(Number);
              callback(ids);
            }
          );
        } else {
          callback(food_ids.map(Number)); // Manual selection only
        }
      };

      getFinalFoodIds((finalFoodIds) => {
        if (!finalFoodIds.length) {
          return res.json({ success: false, message: "No foods found to add" });
        }

        const formattedDate = new Date(menu_date).toISOString().split("T")[0];

        // Step 3: Check if menu exists for that date and meal
        db.query(
          `SELECT id FROM mess_menu WHERE menu_date=? AND meal_type=? AND hostel_id=?`,
          [formattedDate, meal_type, hostel_id],
          (errCheck, menus) => {
            if (errCheck) return res.json({ success: false, message: errCheck.message });

            const doInsertItems = (menuId) => {
              const items = finalFoodIds.map(fid => [menuId, fid]);
              db.query(
                `INSERT INTO mess_menu_items (mess_menu_id, food_id) VALUES ?`,
                [items],
                (errIns) => {
                  if (errIns)
                    return res.json({ success: false, message: errIns.message });
                  return res.json({ success: true, message: "Menu saved ✅" });
                }
              );
            };

            if (menus.length) {
              // Menu exists → replace items
              const menuId = menus[0].id;
              db.query(
                `DELETE FROM mess_menu_items WHERE mess_menu_id=?`,
                [menuId],
                (errDel) => {
                  if (errDel)
                    return res.json({ success: false, message: errDel.message });
                  doInsertItems(menuId);
                }
              );
            } else {
              // Menu does not exist → create menu + items
              db.query(
                `INSERT INTO mess_menu (menu_date, meal_type, hostel_id) VALUES (?, ?, ?)`,
                [formattedDate, meal_type, hostel_id],
                (errInsMenu, resultMenu) => {
                  if (errInsMenu)
                    return res.json({ success: false, message: errInsMenu.message });
                  doInsertItems(resultMenu.insertId);
                }
              );
            }
          }
        );
      });
    }
  );
});

// ======================================
// GET MESS MENU FOR LOGGED HOSTEL
// ======================================
app.get("/mess-menu/:email", (req, res) => {
  const { email } = req.params;

  // 1️⃣ find hostel of logged-in warden
  const hostelSql = `
    SELECT wh.hostel_id
    FROM warden w
    JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    WHERE w.email = ?
  `;

  db.query(hostelSql, [email], (err, result) => {
    if (err || result.length === 0) return res.json({});

    const hostel_id = result[0].hostel_id;

    // 2️⃣ fetch normalized mess menu
    const sql = `
      SELECT 
  m.menu_date,
  m.meal_type,
  f.food_name,
  fc.category_name
FROM mess_menu m
JOIN mess_menu_items mi ON m.id = mi.mess_menu_id
JOIN food_items f ON mi.food_id = f.id
JOIN food_category fc ON f.category_id = fc.category_id
WHERE m.hostel_id = ?
  AND m.menu_date >= CURDATE()
ORDER BY m.menu_date ASC, m.meal_type ASC, fc.category_name ASC
    `;

    db.query(sql, [hostel_id], (err2, results) => {
      if (err2) return res.json({});

      const grouped = {};

results.forEach(row => {
  if (!grouped[row.menu_date]) {
    grouped[row.menu_date] = {
      day_name: new Date(row.menu_date).toLocaleDateString("en-IN", { weekday: "long" }),
      meals: {}
    };
  }

  if (!grouped[row.menu_date].meals[row.meal_type]) {
    grouped[row.menu_date].meals[row.meal_type] = {};
  }

  if (!grouped[row.menu_date].meals[row.meal_type][row.category_name]) {
    grouped[row.menu_date].meals[row.meal_type][row.category_name] = [];
  }

  grouped[row.menu_date].meals[row.meal_type][row.category_name].push(row.food_name);
});

      res.json(grouped);
    });
  });
});

// ------------GET MESS MENU FOR STUDENT HOSTEL (NEXT 7 DAYS)-------------
app.get("/mess-menu/student/:email", (req, res) => {
  const { email } = req.params;

  const hostelSql = `
  SELECT r.hostel_id
  FROM student s
  JOIN rooms r ON s.room_id = r.room_id
  WHERE s.student_email = ?
`;

  db.query(hostelSql, [email], (err, result) => {
    if (err || result.length === 0) {
      console.log("Student hostel fetch error:", err);
      return res.json({});
    }

    const hostel_id = result[0].hostel_id;

    const sql = `
      SELECT 
        DATE_FORMAT(m.menu_date, '%Y-%m-%d') AS menu_date,
        m.meal_type,
        f.food_name
      FROM mess_menu m
      JOIN mess_menu_items mi ON m.id = mi.mess_menu_id
      JOIN food_items f ON mi.food_id = f.id
      WHERE m.hostel_id = ?
        AND m.menu_date >= CURDATE()
        AND m.menu_date <= DATE_ADD(CURDATE(), INTERVAL 6 DAY)
      ORDER BY m.menu_date ASC, m.meal_type ASC
    `;

    db.query(sql, [hostel_id], (err2, results) => {
      if (err2) return res.json({});

      const grouped = {};

      results.forEach(row => {
        if (!row.menu_date) return;

        if (!grouped[row.menu_date]) {
          const dateObj = new Date(row.menu_date + "T00:00:00"); 
          grouped[row.menu_date] = {
            date: row.menu_date,
            day_name: dateObj.toLocaleDateString("en-GB", { weekday: "long" }),
            meals: {}
          };
        }

        if (!grouped[row.menu_date].meals[row.meal_type]) {
          grouped[row.menu_date].meals[row.meal_type] = [];
        }

        grouped[row.menu_date].meals[row.meal_type].push(row.food_name);
      });

      res.json(grouped);
    });
  });
});
// ======================================
// AUTO DELETE OLD MENUS (runs every day)
// ======================================
setInterval(() => {

  const sql = `
    DELETE FROM mess_menu
    WHERE menu_date < CURDATE()
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Menu cleanup error ❌", err);
    } else {
      console.log("Old menus cleaned ✔");
    }
  });

}, 24 * 60 * 60 * 1000); // runs every 24 hours
// ======================================
// WARDEN - ASSIGN STUDENTS TO ROOM (with capacity check)
// ======================================
app.post("/warden/assign-room", async (req, res) => {
  const { room_id, student_ids } = req.body;

  try {
    // get capacity
    const [[room]] = await db.promise().query(
      "SELECT capacity FROM rooms WHERE room_id = ?",
      [room_id]
    );

    const [[count]] = await db.promise().query(
      "SELECT COUNT(*) as total FROM student WHERE room_id = ?",
      [room_id]
    );

    if (count.total + student_ids.length > room.capacity) {
      return res.json({
        success: false,
        message: "Room capacity exceeded ❌"
      });
    }

    for (let student_id of student_ids) {
      await db.promise().query(
        "UPDATE student SET room_id = ? WHERE student_id = ?",
        [room_id, student_id]
      );
    }

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
//////////////////////////////////////////////////////////////////
app.get("/warden/students/:email", async (req, res) => {
  try {
    const { email } = req.params;

    // 1️⃣ Get hostel_id of warden
    const [hostel] = await db.promise().query(
      `SELECT wh.hostel_id
       FROM warden w
       JOIN warden_hostel wh ON w.warden_id = wh.warden_id
       WHERE w.email = ?`,
      [email]
    );

    if (hostel.length === 0) {
      return res.json([]);
    }

    const hostelId = hostel[0].hostel_id;

    // 2️⃣ Get ALL students of that hostel
    const [students] = await db.promise().query(
      `
      SELECT s.student_id, s.name, s.room_id
      FROM student s
      LEFT JOIN rooms r ON s.room_id = r.room_id
      WHERE r.hostel_id = ?
         OR s.room_id IS NULL
      `,
      [hostelId]
    );

    res.json(students);

  } catch (err) {
    console.error(err);
    res.json([]);
  }
});
// ======================================
// GET ALL ROOM ALLOCATIONS (FLAT TABLE)
// ======================================
app.get("/rooms/allocation/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const [rows] = await db.promise().query(`
      SELECT 
        r.room_id,
        r.room_no,
        r.capacity,
        s.student_id,
        s.name
      FROM rooms r
      JOIN warden_hostel wh ON r.hostel_id = wh.hostel_id
      JOIN warden w ON wh.warden_id = w.warden_id
      LEFT JOIN student s ON s.room_id = r.room_id
      WHERE w.email = ?
      ORDER BY r.room_no
    `, [email]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.json([]);
  }
});
// ======================================
// REMOVE STUDENT FROM ROOM
// ======================================
app.post("/warden/remove-student-room", async (req, res) => {
  const { student_id } = req.body;

  try {
    await db.promise().query(
      "UPDATE student SET room_id = NULL WHERE student_id = ?",
      [student_id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
// ======================================
// UPDATED STUDENT IN ROOM (SAFE VERSION)
// ======================================
app.post("/warden/update-student-room", async (req, res) => {
  const { old_student_id, new_student_id, room_id } = req.body;

  console.log("API HIT:", { old_student_id, new_student_id, room_id });

  const connection = await db.promise().getConnection();

  try {
    await connection.beginTransaction();

    // remove old student
    const [removeOld] = await connection.query(
      "UPDATE student SET room_id = NULL WHERE student_id = ?",
      [old_student_id]
    );
    console.log("REMOVE OLD:", removeOld);

    // remove new student from any room
    const [removeNew] = await connection.query(
      "UPDATE student SET room_id = NULL WHERE student_id = ?",
      [new_student_id]
    );
    console.log("REMOVE NEW:", removeNew);

    // assign new student
    const [assignNew] = await connection.query(
      "UPDATE student SET room_id = ? WHERE student_id = ?",
      [room_id, new_student_id]
    );
    console.log("ASSIGN NEW:", assignNew);

    await connection.commit();

    res.json({ success: true });

  } catch (err) {
    await connection.rollback();
    console.error("FULL ERROR:", err); // 🔥 IMPORTANT
    res.json({ success: false, message: err.message });
  } finally {
    connection.release();
  }
});
// ======================================
// GET STUDENTS IN ROOM
// ======================================
app.get("/rooms/:roomId/students/:email", (req, res) => {
  const { roomId, email } = req.params;

  const sql = `
    SELECT s.student_id, s.name, r.room_no
    FROM student s
    JOIN rooms r ON s.room_id = r.room_id
    JOIN course_hostel ch ON s.course_id = ch.course_id
    JOIN warden_hostel wh ON ch.hostel_id = wh.hostel_id
    JOIN warden w ON wh.warden_id = w.warden_id
    WHERE s.room_id = ?
      AND w.email = ?
  `;

  db.query(sql, [roomId, email], (err, result) => {
    if (err) return res.json([]);
    res.json(result);
  });
});
// ======================================
// GET OR CREATE ROOM BY NUMBER
// ======================================
app.post("/get-or-create-room", async (req, res) => {
  const { room_no, capacity, email } = req.body;

  try {
    // get warden_id
    const [warden] = await db.promise().query(
      "SELECT warden_id FROM warden WHERE email = ?",
      [email]
    );

    const warden_id = warden[0].warden_id;

    // get hostel_id
    const [hostels] = await db.promise().query(
      "SELECT hostel_id FROM warden_hostel WHERE warden_id = ?",
      [warden_id]
    );

    const hostel_id = hostels[0].hostel_id;

    // check room in SAME hostel
    const [existing] = await db.promise().query(
      "SELECT * FROM rooms WHERE room_no = ? AND hostel_id = ?",
      [room_no, hostel_id]
    );

    let room_id;

    if (existing.length > 0) {
      room_id = existing[0].room_id;
    } else {
      const [result] = await db.promise().query(
        "INSERT INTO rooms (room_no, capacity, hostel_id) VALUES (?, ?, ?)",
        [room_no, capacity, hostel_id]
      );
      room_id = result.insertId;
    }

    res.json({ success: true, room_id });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
// ================= ROOM OCCUPANCY FOR WARDEN =================
app.get("/warden/rooms/:email", (req, res) => {
  const { email } = req.params;

  const sql = `
    SELECT 
      r.room_id,
      r.room_no,
      r.capacity,
      s.student_id,
      s.name
    FROM rooms r
    LEFT JOIN student s ON s.room_id = r.room_id
    JOIN warden_hostel wh ON r.hostel_id = wh.hostel_id
    JOIN warden w ON wh.warden_id = w.warden_id
    WHERE w.email = ?
    ORDER BY r.room_no
  `;

  db.query(sql, [email], (err, result) => {
    if (err) return res.json({});

    const grouped = {};

    result.forEach(row => {
      if (!grouped[row.room_no]) {
        grouped[row.room_no] = {
          room_no: row.room_no,
          capacity: row.capacity,
          students: []
        };
      }

      if (row.student_id) {
        grouped[row.room_no].students.push({
          student_id: row.student_id,
          name: row.name
        });
      }
    });

    res.json(Object.values(grouped));
  });
});
// ======================================
// GET FOODS BY CATEGORY
// ======================================
app.get("/foods/category/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT id, food_name
    FROM food_items
    WHERE category_id = ?
    ORDER BY food_name
  `;

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.log("Foods by category error:", err);
      return res.json([]);
    }
    res.json(result);
  });
});

// ======================================
// GET FOOD CATEGORIES
// ======================================
app.get("/food-categories", (req, res) => {
  const sql = `SELECT * FROM food_category ORDER BY category_name`;

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Category fetch error:", err);
      return res.json([]);
    }
    res.json(result);
  });
});
// ======================================
// ADD ROOMS 
// ======================================
app.get("/rooms", (req, res) => {
  const sql = `
    SELECT 
      r.room_id,
      r.room_no,
      r.capacity,
      COUNT(s.student_id) AS occupied
    FROM rooms r
    LEFT JOIN student s ON r.room_id = s.room_id
    GROUP BY r.room_id
    ORDER BY r.room_no
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json([]);
    res.json(result);
  });
});
// ======================================
// SELECT ROOMS 
// ======================================
app.get("/room-by-number/:roomNo/:email", async (req, res) => {
  const { roomNo, email } = req.params;

  try {
    // 1️⃣ get warden_id
    const [warden] = await db.promise().query(
      "SELECT warden_id FROM warden WHERE email = ?",
      [email]
    );

    if (warden.length === 0) return res.json({});

    // 2️⃣ get hostel_id
    const [hostels] = await db.promise().query(
      "SELECT hostel_id FROM warden_hostel WHERE warden_id = ?",
      [warden[0].warden_id]
    );

    const hostel_id = hostels[0].hostel_id;

    // 3️⃣ check room in THAT hostel only
    const [room] = await db.promise().query(
      "SELECT * FROM rooms WHERE room_no = ? AND hostel_id = ?",
      [roomNo, hostel_id]
    );

    res.json(room[0] || {});
  } catch (err) {
    console.error(err);
    res.json({});
  }
});

// ===============================
// WORKERS DETAIL APIs
// ===============================

// GET all workers with complaint category name
app.get("/api/workers", (req, res) => {
  const query = `
    SELECT 
      w.id,
      w.name,
      w.phone_no,
      w.category,
      cc.category_name
    FROM workers w
    LEFT JOIN complaint_categories cc ON w.category = cc.id
    ORDER BY w.id DESC
  `;

  db.query(query, (err, rows) => {
    if (err) {
      console.error("Error fetching workers:", err);
      return res.status(500).json({ error: "Error fetching workers" });
    }

    return res.json(rows);
  });
});

// GET complaint categories for dropdown
app.get("/api/workers/categories", (req, res) => {
  const query = `
    SELECT 
      id,
      category_name
    FROM complaint_categories
    ORDER BY category_name ASC
  `;

  db.query(query, (err, rows) => {
    if (err) {
      console.error("Error fetching complaint categories:", err);
      return res.status(500).json({ error: "Error fetching complaint categories" });
    }

    return res.json(rows);
  });
});

// ADD new worker
app.post("/api/workers", (req, res) => {
  const { name, phone_no, category } = req.body;

  if (!name || !phone_no || !category) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const query = `
    INSERT INTO workers (name, phone_no, category)
    VALUES (?, ?, ?)
  `;

  db.query(query, [name, phone_no, category], (err, result) => {
    if (err) {
      console.error("Error adding worker:", err);
      return res.status(500).json({ error: "Error adding worker" });
    }

    return res.status(201).json({
      message: "Worker added successfully",
      id: result.insertId,
    });
  });
});

// DELETE worker
app.delete("/api/workers/:id", (req, res) => {
  const { id } = req.params;

  const query = "DELETE FROM workers WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting worker:", err);
      return res.status(500).json({ error: "Error deleting worker" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    return res.json({ message: "Worker deleted successfully" });
  });
});
// ================= ATTENDANCE API =================

// GET today's attendance data for warden by date + email
app.get("/attendance/:date/:email", (req, res) => {
  const { date, email } = req.params;

  // 1) Find warden_id + hostel_id using warden + warden_hostel
  const getWardenQuery = `
    SELECT 
      w.warden_id,
      wh.hostel_id
    FROM warden w
    INNER JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    WHERE w.email = ?
    LIMIT 1
  `;

  db.query(getWardenQuery, [email], (err, wardenResult) => {
    if (err) {
      console.error("Error fetching warden details:", err);
      return res.status(500).json({ message: "Database error while fetching warden" });
    }

    if (wardenResult.length === 0) {
      return res.status(404).json({ message: "Warden not found or no hostel assigned" });
    }

    const hostelId = wardenResult[0].hostel_id;

    // 2) Get all students of that hostel using student -> rooms
    const getStudentsAttendanceQuery = `
      SELECT 
        s.student_id,
        s.name,
        r.room_no,
        r.hostel_id,
        COALESCE(a.status, 'Absent') AS status
      FROM student s
      INNER JOIN rooms r ON s.room_id = r.room_id
      LEFT JOIN attendance a 
        ON s.student_id = a.student_id 
        AND a.date = ?
      WHERE r.hostel_id = ?
      ORDER BY r.room_no ASC, s.name ASC
    `;

    db.query(getStudentsAttendanceQuery, [date, hostelId], (err2, studentResult) => {
      if (err2) {
        console.error("Error fetching students attendance:", err2);
        return res.status(500).json({ message: "Database error while fetching attendance" });
      }

      return res.json(studentResult);
    });
  });
});

// POST mark/update attendance
app.post("/attendance/mark", (req, res) => {
  const { attendanceData } = req.body;

  if (!attendanceData || !Array.isArray(attendanceData) || attendanceData.length === 0) {
    return res.status(400).json({ message: "Attendance data is required" });
  }

  const wardenEmail = attendanceData[0].warden_email;

  if (!wardenEmail) {
    return res.status(400).json({ message: "warden_email is required" });
  }

  // 1) Find warden_id from warden table
  const getWardenQuery = `
    SELECT warden_id
    FROM warden
    WHERE email = ?
    LIMIT 1
  `;

  db.query(getWardenQuery, [wardenEmail], (err, wardenResult) => {
    if (err) {
      console.error("Error fetching warden for attendance save:", err);
      return res.status(500).json({ message: "Database error while fetching warden" });
    }

    if (wardenResult.length === 0) {
      return res.status(404).json({ message: "Warden not found" });
    }

    const wardenId = wardenResult[0].warden_id;

    // 2) Validate attendance data
    for (const item of attendanceData) {
      if (!item.student_id || !item.hostel_id || !item.date || !item.status) {
        return res.status(400).json({ message: "Invalid attendance data format" });
      }
    }

    // 3) Insert or update attendance
    const insertAttendanceQuery = `
      INSERT INTO attendance (student_id, hostel_id, date, status, marked_by)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        hostel_id = VALUES(hostel_id),
        marked_by = VALUES(marked_by)
    `;

    const values = attendanceData.map((item) => [
      item.student_id,
      item.hostel_id,
      item.date,
      item.status,
      wardenId,
    ]);

    db.query(insertAttendanceQuery, [values], (err2, result) => {
      if (err2) {
        console.error("Error saving attendance:", err2);
        return res.status(500).json({ message: "Failed to save attendance" });
      }

      return res.json({
        message: "Attendance submitted successfully",
        affectedRows: result.affectedRows,
      });
    });
  });
});

// ================= WARDEN ATTENDANCE RECORDS APIs =================

// GET students for logged-in warden (for dropdown filter)
app.get("/warden/students/:email", (req, res) => {
  const { email } = req.params;

  const getWardenQuery = `
    SELECT 
      wh.hostel_id
    FROM warden w
    INNER JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    WHERE w.email = ?
    LIMIT 1
  `;

  db.query(getWardenQuery, [email], (err, wardenResult) => {
    if (err) {
      console.error("Error fetching warden hostel:", err);
      return res.status(500).json({ message: "Database error while fetching warden" });
    }

    if (wardenResult.length === 0) {
      return res.status(404).json({ message: "Warden not found or no hostel assigned" });
    }

    const hostelId = wardenResult[0].hostel_id;

    const getStudentsQuery = `
      SELECT 
        s.student_id,
        s.name,
        r.room_no
      FROM student s
      INNER JOIN rooms r ON s.room_id = r.room_id
      WHERE r.hostel_id = ?
      ORDER BY r.room_no ASC, s.name ASC
    `;

    db.query(getStudentsQuery, [hostelId], (err2, studentsResult) => {
      if (err2) {
        console.error("Error fetching students:", err2);
        return res.status(500).json({ message: "Database error while fetching students" });
      }

      return res.json(studentsResult);
    });
  });
});

// GET attendance records for logged-in warden
app.get("/attendance-records/:email", (req, res) => {
  const { email } = req.params;

  // 1) Find warden hostel
  const getWardenQuery = `
    SELECT 
      w.warden_id,
      wh.hostel_id
    FROM warden w
    INNER JOIN warden_hostel wh ON w.warden_id = wh.warden_id
    WHERE w.email = ?
    LIMIT 1
  `;

  db.query(getWardenQuery, [email], (err, wardenResult) => {
    if (err) {
      console.error("Error fetching warden for records:", err);
      return res.status(500).json({ message: "Database error while fetching warden" });
    }

    if (wardenResult.length === 0) {
      return res.status(404).json({ message: "Warden not found or no hostel assigned" });
    }

    const hostelId = wardenResult[0].hostel_id;

    // 2) Get attendance records of students belonging to that hostel
    const getAttendanceRecordsQuery = `
      SELECT 
        a.attendance_id,
        a.student_id,
        s.name AS student_name,
        r.room_no,
        a.date,
        a.status
      FROM attendance a
      INNER JOIN student s ON a.student_id = s.student_id
      INNER JOIN rooms r ON s.room_id = r.room_id
      WHERE r.hostel_id = ?
      ORDER BY a.date DESC, r.room_no ASC, s.name ASC
    `;

    db.query(getAttendanceRecordsQuery, [hostelId], (err2, recordsResult) => {
      if (err2) {
        console.error("Error fetching attendance records:", err2);
        return res.status(500).json({ message: "Database error while fetching attendance records" });
      }

      return res.json(recordsResult);
    });
  });
});

// ================= SERVER =================
app.listen(5000, () => {
  console.log("Server running → http://localhost:5000");
});
