
async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard');
        const data = await response.json();

        document.getElementById('patientCount').textContent = data.patients;
        document.getElementById('doctorCount').textContent = data.doctors;
        document.getElementById('appointmentCount').textContent = data.appointments;
    } catch (error) {
        console.error('Dashboard loading failed:', error);
    }
}

async function showSection(section) {
    const workspace = document.getElementById('workspace');

    if (section === 'patients') {
        workspace.innerHTML = `
            <h2>Patient Management</h2>
            <form id="patientForm">
                <input name="name" placeholder="Patient Name" required>
                <input name="age" type="number" placeholder="Age" required>
                <input name="phone" placeholder="Phone Number" required>
                <input name="problem" placeholder="Medical Problem" required>
                <button type="submit">Register Patient</button>
            </form>
            <div id="patientList"></div>
        `;

        document.getElementById('patientForm').addEventListener('submit', addPatient);
        loadPatients();
    }

    else if (section === 'doctors') {
        workspace.innerHTML = `
            <h2>Doctor Management</h2>
            <form id="doctorForm">
                <input name="name" placeholder="Doctor Name" required>
                <input name="specialization" placeholder="Specialization" required>
                <input name="phone" placeholder="Phone Number" required>
                <button type="submit">Add Doctor</button>
            </form>
            <div id="doctorList"></div>
        `;

        document.getElementById('doctorForm').addEventListener('submit', addDoctor);
        loadDoctors();
    }

    else if (section === 'appointments') {
        workspace.innerHTML = `
            <h2>Appointment Management</h2>
            <form id="appointmentForm">
                <input name="patient_id" type="number" placeholder="Patient ID" required>
                <input name="doctor_id" type="number" placeholder="Doctor ID" required>
                <input name="date" type="date" required>
                <input name="time" type="time" required>
                <button type="submit">Book Appointment</button>
            </form>
            <div id="appointmentList"></div>
        `;

        document.getElementById('appointmentForm').addEventListener('submit', addAppointment);
        loadAppointments();
    }
}

async function addPatient(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    const response = await fetch('/api/patients', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    const result = await response.json();
    alert(result.message || result.error);
    if (response.ok) {
        event.target.reset();
        loadPatients();
        loadDashboard();
    }
}

async function loadPatients() {
    const response = await fetch('/api/patients');
    const patients = await response.json();

    document.getElementById('patientList').innerHTML =
        '<h3>Registered Patients</h3>' +
        patients.map(p => `<p>#${p.id} - ${escapeHTML(p.name)} | Age: ${p.age} | ${escapeHTML(p.problem)}</p>`).join('');
}

async function addDoctor(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    const response = await fetch('/api/doctors', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    const result = await response.json();
    alert(result.message || result.error);
    if (response.ok) {
        event.target.reset();
        loadDoctors();
        loadDashboard();
    }
}

async function loadDoctors() {
    const response = await fetch('/api/doctors');
    const doctors = await response.json();

    document.getElementById('doctorList').innerHTML =
        '<h3>Registered Doctors</h3>' +
        doctors.map(d => `<p>#${d.id} - ${escapeHTML(d.name)} | ${escapeHTML(d.specialization)}</p>`).join('');
}

async function addAppointment(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    const result = await response.json();
    alert(result.message || result.error);
    if (response.ok) {
        event.target.reset();
        loadAppointments();
        loadDashboard();
    }
}

async function loadAppointments() {
    const response = await fetch('/api/appointments');
    const appointments = await response.json();

    document.getElementById('appointmentList').innerHTML =
        '<h3>Booked Appointments</h3>' +
        appointments.map(a => `<p>Patient: ${escapeHTML(a.patient_name)} | Doctor: ${escapeHTML(a.doctor_name)} | ${escapeHTML(a.date)} at ${escapeHTML(a.time)}</p>`).join('');
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
    })[char]);
}

loadDashboard();
