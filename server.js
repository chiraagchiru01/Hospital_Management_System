
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const db = new Database(path.join(__dirname, 'database.db'));

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

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

// Safe database migration for existing installations
const appointmentColumns = db.prepare(
    'PRAGMA table_info(appointments)'
).all().map(column => column.name);

if (!appointmentColumns.includes('status')) {
    db.exec(`
        ALTER TABLE appointments
        ADD COLUMN status TEXT NOT NULL DEFAULT 'Scheduled'
    `);
}

// Billing table
db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        appointment_id INTEGER,
        consultation_fee REAL NOT NULL DEFAULT 0,
        treatment_charges REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'Pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(patient_id) REFERENCES patients(id),
        FOREIGN KEY(appointment_id) REFERENCES appointments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_date
    ON appointments(date);

    CREATE INDEX IF NOT EXISTS idx_appointments_doctor
    ON appointments(doctor_id, date, time);

    CREATE INDEX IF NOT EXISTS idx_bills_patient
    ON bills(patient_id);
`);

// Helpers
function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function validId(value) {
    return Number.isInteger(Number(value)) && Number(value) > 0;
}

function validPhone(phone) {
    return /^[0-9+() -]{7,20}$/.test(phone);
}

function normalizeDate(value) {
    if (typeof value !== 'string') return null;
    const date = value.trim();

    // HTML date inputs submit YYYY-MM-DD. Also accept DD/MM/YYYY or DD-MM-YYYY.
    let match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        match = date.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
        if (match) {
            const [, day, month, year] = match;
            return normalizeDate(`${year}-${month}-${day}`);
        }
    }
    if (!match) return null;

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
        ? `${yearText}-${monthText}-${dayText}`
        : null;
}

function normalizeTime(value) {
    if (typeof value !== 'string') return null;
    const time = value.trim();

    // Accept HTML time values with or without seconds.
    let match = time.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (match) {
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    }

    // Also accept 12-hour values such as 2:30 PM.
    match = time.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
    if (!match) return null;

    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function validDate(date) {
    return normalizeDate(date) !== null;
}

function validTime(time) {
    return normalizeTime(time) !== null;
}

function validatePatient(body) {
    const name = clean(body.name);
    const phone = clean(body.phone);
    const problem = clean(body.problem);
    const age = Number(body.age);

    if (!name || name.length > 100) {
        return 'Enter a valid patient name (maximum 100 characters).';
    }

    if (!Number.isInteger(age) || age < 0 || age > 120) {
        return 'Enter a valid age between 0 and 120.';
    }

    if (!validPhone(phone)) {
        return 'Enter a valid phone number.';
    }

    if (!problem || problem.length > 200) {
        return 'Enter a medical problem (maximum 200 characters).';
    }

    return null;
}

function validateDoctor(body) {
    const name = clean(body.name);
    const specialization = clean(body.specialization);
    const phone = clean(body.phone);

    if (!name || name.length > 100) {
        return 'Enter a valid doctor name.';
    }

    if (!specialization || specialization.length > 100) {
        return 'Enter a valid specialization.';
    }

    if (!validPhone(phone)) {
        return 'Enter a valid doctor phone number.';
    }

    return null;
}

function validateAppointment(body) {
    if (!validId(body.patient_id) || !validId(body.doctor_id)) {
        return 'Select a valid patient and doctor.';
    }

    if (!validDate(body.date) || !validTime(body.time)) {
        return 'Enter a valid appointment date and time.';
    }

    const patient = db.prepare(
        'SELECT id FROM patients WHERE id = ?'
    ).get(Number(body.patient_id));

    const doctor = db.prepare(
        'SELECT id FROM doctors WHERE id = ?'
    ).get(Number(body.doctor_id));

    if (!patient || !doctor) {
        return 'Selected patient or doctor does not exist.';
    }

    return null;
}

function hasAppointmentConflict(doctorId, date, time, excludeId = 0) {
    return !!db.prepare(`
        SELECT id FROM appointments
        WHERE doctor_id = ?
        AND date = ?
        AND time = ?
        AND status != 'Cancelled'
        AND id != ?
    `).get(doctorId, date, time, excludeId);
}

function handleError(res, error) {
    console.error(error);

    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return res.status(409).json({
            error: 'This record is linked to other records and cannot be deleted.'
        });
    }

    return res.status(500).json({
        error: 'An internal server error occurred.'
    });
}

// Dashboard
app.get('/api/dashboard', (req, res) => {
    try {
        const patients = db.prepare(
            'SELECT COUNT(*) AS count FROM patients'
        ).get().count;

        const doctors = db.prepare(
            'SELECT COUNT(*) AS count FROM doctors'
        ).get().count;

        const appointments = db.prepare(
            'SELECT COUNT(*) AS count FROM appointments'
        ).get().count;

        const today = new Date().toLocaleDateString('en-CA');

        const todayAppointments = db.prepare(`
            SELECT COUNT(*) AS count
            FROM appointments
            WHERE date = ? AND status != 'Cancelled'
        `).get(today).count;

        const completed = db.prepare(`
            SELECT COUNT(*) AS count
            FROM appointments WHERE status = 'Completed'
        `).get().count;

        const pending = db.prepare(`
            SELECT COUNT(*) AS count
            FROM appointments WHERE status = 'Scheduled'
        `).get().count;

        res.json({
            patients,
            doctors,
            appointments,
            todayAppointments,
            completed,
            pending
        });
    } catch (error) {
        handleError(res, error);
    }
});

// PATIENT ROUTES

app.get('/api/patients', (req, res) => {
    try {
        res.json(
            db.prepare('SELECT * FROM patients ORDER BY id DESC').all()
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.get('/api/patients/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid patient ID.' });
        }

        const patient = db.prepare(
            'SELECT * FROM patients WHERE id = ?'
        ).get(Number(req.params.id));

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        res.json(patient);
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/api/patients', (req, res) => {
    try {
        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const result = db.prepare(`
            INSERT INTO patients (name, age, phone, problem)
            VALUES (?, ?, ?, ?)
        `).run(
            clean(req.body.name),
            Number(req.body.age),
            clean(req.body.phone),
            clean(req.body.problem)
        );

        res.status(201).json({
            message: 'Patient registered successfully!',
            id: result.lastInsertRowid
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.put('/api/patients/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid patient ID.' });
        }

        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const result = db.prepare(`
            UPDATE patients
            SET name = ?, age = ?, phone = ?, problem = ?
            WHERE id = ?
        `).run(
            clean(req.body.name),
            Number(req.body.age),
            clean(req.body.phone),
            clean(req.body.problem),
            Number(req.params.id)
        );

        if (!result.changes) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        res.json({ message: 'Patient updated successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

app.delete('/api/patients/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid patient ID.' });
        }

        const result = db.prepare(
            'DELETE FROM patients WHERE id = ?'
        ).run(Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        res.json({ message: 'Patient deleted successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

// DOCTOR ROUTES

app.get('/api/doctors', (req, res) => {
    try {
        res.json(
            db.prepare('SELECT * FROM doctors ORDER BY id DESC').all()
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.get('/api/doctors/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid doctor ID.' });
        }

        const doctor = db.prepare(
            'SELECT * FROM doctors WHERE id = ?'
        ).get(Number(req.params.id));

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found.' });
        }

        res.json(doctor);
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/api/doctors', (req, res) => {
    try {
        const error = validateDoctor(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const result = db.prepare(`
            INSERT INTO doctors (name, specialization, phone)
            VALUES (?, ?, ?)
        `).run(
            clean(req.body.name),
            clean(req.body.specialization),
            clean(req.body.phone)
        );

        res.status(201).json({
            message: 'Doctor added successfully!',
            id: result.lastInsertRowid
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.put('/api/doctors/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid doctor ID.' });
        }

        const error = validateDoctor(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const result = db.prepare(`
            UPDATE doctors
            SET name = ?, specialization = ?, phone = ?
            WHERE id = ?
        `).run(
            clean(req.body.name),
            clean(req.body.specialization),
            clean(req.body.phone),
            Number(req.params.id)
        );

        if (!result.changes) {
            return res.status(404).json({ error: 'Doctor not found.' });
        }

        res.json({ message: 'Doctor updated successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

app.delete('/api/doctors/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid doctor ID.' });
        }

        const result = db.prepare(
            'DELETE FROM doctors WHERE id = ?'
        ).run(Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({ error: 'Doctor not found.' });
        }

        res.json({ message: 'Doctor deleted successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

// APPOINTMENT ROUTES

app.get('/api/appointments', (req, res) => {
    try {
        const appointments = db.prepare(`
            SELECT
                a.id,
                a.patient_id,
                a.doctor_id,
                p.name AS patient_name,
                d.name AS doctor_name,
                d.specialization,
                a.date,
                a.time,
                a.status
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors d ON a.doctor_id = d.id
            ORDER BY a.date DESC, a.time DESC
        `).all();

        res.json(appointments);
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/api/appointments', (req, res) => {
    try {
        const error = validateAppointment(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        req.body.date = normalizeDate(req.body.date);
        req.body.time = normalizeTime(req.body.time);

        const patientId = Number(req.body.patient_id);
        const doctorId = Number(req.body.doctor_id);

        if (hasAppointmentConflict(
            doctorId, req.body.date, req.body.time
        )) {
            return res.status(409).json({
                error: 'This doctor already has an appointment at this time.'
            });
        }

        const result = db.prepare(`
            INSERT INTO appointments
            (patient_id, doctor_id, date, time, status)
            VALUES (?, ?, ?, ?, 'Scheduled')
        `).run(
            patientId,
            doctorId,
            req.body.date,
            req.body.time
        );

        res.status(201).json({
            message: 'Appointment booked successfully!',
            id: result.lastInsertRowid
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.put('/api/appointments/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid appointment ID.' });
        }

        const existing = db.prepare(
            'SELECT id FROM appointments WHERE id = ?'
        ).get(Number(req.params.id));

        if (!existing) {
            return res.status(404).json({ error: 'Appointment not found.' });
        }

        const error = validateAppointment(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        req.body.date = normalizeDate(req.body.date);
        req.body.time = normalizeTime(req.body.time);

        const status = req.body.status || 'Scheduled';

        if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid appointment status.' });
        }

        const doctorId = Number(req.body.doctor_id);

        if (status !== 'Cancelled' && hasAppointmentConflict(
            doctorId,
            req.body.date,
            req.body.time,
            Number(req.params.id)
        )) {
            return res.status(409).json({
                error: 'This doctor already has an appointment at this time.'
            });
        }

        db.prepare(`
            UPDATE appointments
            SET patient_id = ?, doctor_id = ?, date = ?, time = ?, status = ?
            WHERE id = ?
        `).run(
            Number(req.body.patient_id),
            doctorId,
            req.body.date,
            req.body.time,
            status,
            Number(req.params.id)
        );

        res.json({ message: 'Appointment updated successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

app.patch('/api/appointments/:id/status', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid appointment ID.' });
        }

        const { status } = req.body;

        if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid appointment status.' });
        }

        const result = db.prepare(`
            UPDATE appointments SET status = ? WHERE id = ?
        `).run(status, Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({ error: 'Appointment not found.' });
        }

        res.json({ message: `Appointment marked as ${status}.` });
    } catch (error) {
        handleError(res, error);
    }
});

app.delete('/api/appointments/:id', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid appointment ID.' });
        }

        const result = db.prepare(
            'DELETE FROM appointments WHERE id = ?'
        ).run(Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({ error: 'Appointment not found.' });
        }

        res.json({ message: 'Appointment deleted successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

// BILLING ROUTES

app.get('/api/bills', (req, res) => {
    try {
        const bills = db.prepare(`
            SELECT
                b.*,
                p.name AS patient_name
            FROM bills b
            JOIN patients p ON b.patient_id = p.id
            ORDER BY b.id DESC
        `).all();

        res.json(bills);
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/api/bills', (req, res) => {
    try {
        const patientId = Number(req.body.patient_id);
        const appointmentId = req.body.appointment_id
            ? Number(req.body.appointment_id)
            : null;

        const consultation = Number(req.body.consultation_fee);
        const treatment = Number(req.body.treatment_charges);

        if (!validId(patientId) ||
            !Number.isFinite(consultation) ||
            !Number.isFinite(treatment) ||
            consultation < 0 || treatment < 0 ||
            consultation > 10000000 || treatment > 10000000) {
            return res.status(400).json({
                error: 'Enter valid patient and billing details.'
            });
        }

        const patient = db.prepare(
            'SELECT id FROM patients WHERE id = ?'
        ).get(patientId);

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        if (appointmentId !== null) {
            if (!validId(appointmentId)) {
                return res.status(400).json({ error: 'Invalid appointment ID.' });
            }

            const appointment = db.prepare(`
                SELECT id, patient_id FROM appointments WHERE id = ?
            `).get(appointmentId);

            if (!appointment || appointment.patient_id !== patientId) {
                return res.status(400).json({
                    error: 'Appointment does not belong to this patient.'
                });
            }
        }

        const total = consultation + treatment;

        const result = db.prepare(`
            INSERT INTO bills
            (patient_id, appointment_id, consultation_fee, treatment_charges, total)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            patientId,
            appointmentId,
            consultation,
            treatment,
            total
        );

        res.status(201).json({
            message: 'Bill generated successfully!',
            id: result.lastInsertRowid,
            total
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.patch('/api/bills/:id/payment', (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid bill ID.' });
        }

        const { payment_status } = req.body;

        if (!['Paid', 'Pending'].includes(payment_status)) {
            return res.status(400).json({ error: 'Invalid payment status.' });
        }

        const result = db.prepare(`
            UPDATE bills SET payment_status = ? WHERE id = ?
        `).run(payment_status, Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({ error: 'Bill not found.' });
        }

        res.json({ message: 'Payment status updated successfully!' });
    } catch (error) {
        handleError(res, error);
    }
});

// API fallback
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
});

// General error handler
app.use((error, req, res, next) => {
    console.error(error);

    if (res.headersSent) return next(error);

    res.status(400).json({
        error: 'Invalid request.'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`MediCare server running at http://localhost:${PORT}`);
});
