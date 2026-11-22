
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const db = new Database('database.db');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        phone TEXT NOT NULL,
        problem TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        specialization TEXT NOT NULL,
        phone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        FOREIGN KEY(patient_id) REFERENCES patients(id),
        FOREIGN KEY(doctor_id) REFERENCES doctors(id)
    );
`);

// Dashboard statistics
app.get('/api/dashboard', (req, res) => {
    const patients = db.prepare('SELECT COUNT(*) AS count FROM patients').get().count;
    const doctors = db.prepare('SELECT COUNT(*) AS count FROM doctors').get().count;
    const appointments = db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count;

    res.json({ patients, doctors, appointments });
});

// Patient routes
app.get('/api/patients', (req, res) => {
    res.json(db.prepare('SELECT * FROM patients ORDER BY id DESC').all());
});

app.post('/api/patients', (req, res) => {
    const { name, age, phone, problem } = req.body;

    if (!name || !phone || !problem || !Number.isInteger(Number(age)) || Number(age) < 0) {
        return res.status(400).json({ error: 'Please enter valid patient details.' });
    }

    db.prepare(`
        INSERT INTO patients (name, age, phone, problem)
        VALUES (?, ?, ?, ?)
    `).run(name.trim(), Number(age), phone.trim(), problem.trim());

    res.status(201).json({ message: 'Patient registered successfully!' });
});

// Doctor routes
app.get('/api/doctors', (req, res) => {
    res.json(db.prepare('SELECT * FROM doctors ORDER BY id DESC').all());
});

app.post('/api/doctors', (req, res) => {
    const { name, specialization, phone } = req.body;

    if (!name?.trim() || !specialization?.trim() || !phone?.trim()) {
        return res.status(400).json({ error: 'Please enter all doctor details.' });
    }

    db.prepare(`
        INSERT INTO doctors (name, specialization, phone)
        VALUES (?, ?, ?)
    `).run(name.trim(), specialization.trim(), phone.trim());

    res.status(201).json({ message: 'Doctor added successfully!' });
});

// Appointment routes
app.get('/api/appointments', (req, res) => {
    const appointments = db.prepare(`
        SELECT
            appointments.id,
            patients.name AS patient_name,
            doctors.name AS doctor_name,
            appointments.date,
            appointments.time
        FROM appointments
        JOIN patients ON appointments.patient_id = patients.id
        JOIN doctors ON appointments.doctor_id = doctors.id
        ORDER BY appointments.date, appointments.time
    `).all();

    res.json(appointments);
});

app.post('/api/appointments', (req, res) => {
    const { patient_id, doctor_id, date, time } = req.body;

    if (!Number.isInteger(Number(patient_id)) ||
        !Number.isInteger(Number(doctor_id)) ||
        !date || !time) {
        return res.status(400).json({ error: 'Please enter valid appointment details.' });
    }

    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(Number(patient_id));
    const doctor = db.prepare('SELECT id FROM doctors WHERE id = ?').get(Number(doctor_id));

    if (!patient || !doctor) {
        return res.status(400).json({ error: 'Patient ID or Doctor ID does not exist.' });
    }

    db.prepare(`
        INSERT INTO appointments (patient_id, doctor_id, date, time)
        VALUES (?, ?, ?, ?)
    `).run(Number(patient_id), Number(doctor_id), date, time);

    res.status(201).json({ message: 'Appointment booked successfully!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`MediCare server running at http://localhost:${PORT}`);
});
