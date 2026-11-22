
let appointmentChart = null;
const API = '/api';

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
    })[char]);
}

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(API + endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Request failed.');

    return data;
}

function notify(message) {
    alert(message);
}

function refreshIcons() {
    if (window.lucide) lucide.createIcons();
}

function getFormData(form) {
    return Object.fromEntries(new FormData(form));
}

function injectStyles() {
    if (document.getElementById('medicareStyles')) return;

    const style = document.createElement('style');
    style.id = 'medicareStyles';

    style.textContent = `
        .mc-form {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:18px;
        }
        .mc-field {
            display:flex;
            flex-direction:column;
            gap:8px;
        }
        .mc-field label {
            font-size:14px;
            font-weight:600;
        }
        .mc-field input,.mc-field select,.mc-field textarea {
            width:100%;
            box-sizing:border-box;
            padding:13px;
            border:1px solid #dce3eb;
            border-radius:9px;
            background:#f9fbfd;
            font:inherit;
            outline:none;
        }
        .mc-field input:focus,.mc-field select:focus,
        .mc-field textarea:focus {
            border-color:#2386a8;
            box-shadow:0 0 0 3px rgba(35,134,168,.12);
        }
        .mc-field.full {grid-column:1/-1}
        .mc-field textarea {min-height:90px;resize:vertical}
        .mc-btn {
            border:0;
            border-radius:8px;
            padding:11px 17px;
            background:#2386a8;
            color:white;
            font-weight:600;
            cursor:pointer;
            margin:4px;
        }
        .mc-btn:hover {filter:brightness(.9)}
        .mc-btn.danger {background:#dc4444}
        .mc-btn.secondary {background:#64748b}
        .mc-actions {white-space:nowrap}
        .mc-status {
            padding:6px 10px;
            border-radius:20px;
            font-size:12px;
            font-weight:600;
        }
        .mc-status.Scheduled {background:#e0efff;color:#1762a0}
        .mc-status.Completed {background:#dcfce7;color:#167443}
        .mc-status.Cancelled {background:#fee2e2;color:#b42318}
        .mc-status.Paid {background:#dcfce7;color:#167443}
        .mc-status.Pending {background:#fff1cc;color:#936300}
        .mc-table-wrap {overflow-x:auto}
        .mc-table-wrap table {width:100%;border-collapse:collapse}
        .mc-table-wrap th,.mc-table-wrap td {
            padding:13px;
            text-align:left;
            border-bottom:1px solid #e8edf2;
        }
        .mc-table-wrap th {font-size:13px;color:#64748b}
        .mc-empty {text-align:center;padding:25px;color:#8793a1}
        .mc-section-note {color:#84909e;margin:6px 0 20px}
        @media(max-width:600px) {
            .mc-form {grid-template-columns:1fr}
            .mc-field.full {grid-column:auto}
        }
    `;

    document.head.appendChild(style);
}

function field(label, name, type = 'text', placeholder = '', required = true) {
    return `
        <div class="mc-field">
            <label for="f_${name}">${label}${required ? ' *' : ''}</label>
            <input id="f_${name}" name="${name}" type="${type}"
                placeholder="${placeholder}" ${required ? 'required' : ''}>
        </div>
    `;
}

function panel(title, subtitle, content) {
    return `
        <div class="panel">
            <div class="panel-heading">
                <div>
                    <h3>${title}</h3>
                    <p>${subtitle}</p>
                </div>
            </div>
            ${content}
        </div>
    `;
}

function renderTable(headers, rows, colspan) {
    return `
        <div class="mc-table-wrap">
            <table>
                <thead>
                    <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows || `<tr><td colspan="${colspan}" class="mc-empty">No records found.</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
}

// DASHBOARD

async function loadDashboard() {
    try {
        const [stats, appointments] = await Promise.all([
            apiRequest('/dashboard'),
            apiRequest('/appointments')
        ]);

        document.getElementById('patientCount').textContent = stats.patients;
        document.getElementById('doctorCount').textContent = stats.doctors;
        document.getElementById('appointmentCount').textContent = stats.appointments;
        document.getElementById('todayCount').textContent =
            stats.todayAppointments ?? 0;

        loadRecentAppointments(appointments);
        renderAppointmentChart(appointments);

    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function loadRecentAppointments(appointments) {
    const tbody = document.getElementById('recentAppointments');
    if (!tbody) return;

    const recent = [...appointments]
        .sort((a, b) =>
            (b.date + b.time).localeCompare(a.date + a.time)
        ).slice(0, 5);

    tbody.innerHTML = recent.length ? recent.map(a => `
        <tr>
            <td>${escapeHTML(a.patient_name)}</td>
            <td>${escapeHTML(a.doctor_name)}</td>
            <td>${escapeHTML(a.date)}</td>
            <td>${escapeHTML(a.time)}</td>
            <td><span class="mc-status ${escapeHTML(a.status)}">${escapeHTML(a.status)}</span></td>
        </tr>
    `).join('') : `
        <tr><td colspan="5" class="mc-empty">No appointments yet.</td></tr>
    `;
}

function renderAppointmentChart(appointments) {
    const canvas = document.getElementById('appointmentChart');
    if (!canvas || !window.Chart) return;

    // Count every active booking, not only appointments marked Completed.
    // Cancelled appointments are excluded from the graph.
    const countsByDate = new Map();

    appointments
        .filter(appointment => appointment.status !== 'Cancelled')
        .forEach(appointment => {
            const date = appointment.date;
            if (!date) return;
            countsByDate.set(date, (countsByDate.get(date) || 0) + 1);
        });

    const dates = [...countsByDate.keys()].sort();
    const labels = dates.map(date => {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
            undefined,
            { month: 'short', day: 'numeric', timeZone: 'UTC' }
        );
    });
    const values = dates.map(date => countsByDate.get(date));

    if (appointmentChart) appointmentChart.destroy();

    appointmentChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Appointments',
                data: values,
                borderColor: '#2386a8',
                backgroundColor: 'rgba(35,134,168,0.12)',
                fill: true,
                tension: 0.4,
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            }
        }
    });
}

// NAVIGATION

function addBillingNavigation() {
    const links = document.querySelectorAll('.nav-link');

    if (!links.length || document.querySelector('[data-section="billing"]')) return;

    const parent = links[0].parentElement;
    const link = document.createElement('a');

    link.href = '#';
    link.className = 'nav-link';
    link.dataset.section = 'billing';
    link.innerHTML = '<i data-lucide="receipt"></i><span>Billing</span>';

    parent.appendChild(link);
}

async function showSection(section) {
    const dashboard = document.getElementById('dashboardSection');
    const workspace = document.getElementById('workspace');

    dashboard.hidden = section !== 'dashboard';
    workspace.hidden = section === 'dashboard';

    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });

    const titles = {
        dashboard: ['Dashboard Overview', 'Welcome back! Here is what is happening today.'],
        patients: ['Patient Management', 'Register and manage hospital patients.'],
        doctors: ['Doctor Management', 'Manage your hospital doctors.'],
        appointments: ['Appointment Management', 'Schedule and manage appointments.'],
        billing: ['Billing Management', 'Generate bills and track payments.']
    };

    if (!titles[section]) return;

    document.getElementById('pageTitle').textContent = titles[section][0];
    document.getElementById('pageSubtitle').textContent = titles[section][1];

    if (section === 'dashboard') await loadDashboard();
    if (section === 'patients') await renderPatients();
    if (section === 'doctors') await renderDoctors();
    if (section === 'appointments') await renderAppointments();
    if (section === 'billing') await renderBilling();

    refreshIcons();
}

// PATIENT MANAGEMENT

async function renderPatients() {
    const workspace = document.getElementById('workspace');

    workspace.innerHTML = `
        ${panel('Register New Patient',
            'Enter the personal and medical details.',
            `
            <form id="patientForm" class="mc-form">
                ${field('Full Name', 'name', 'text', 'Enter patient name')}
                ${field('Age', 'age', 'number', 'Enter age')}
                ${field('Phone Number', 'phone', 'tel', 'Enter phone number')}
                <div class="mc-field">
                    <label for="f_problem">Medical Problem *</label>
                    <textarea id="f_problem" name="problem"
                        maxlength="200" placeholder="Describe medical problem" required></textarea>
                </div>
                <div class="mc-field full">
                    <button class="mc-btn" type="submit">+ Register Patient</button>
                </div>
            </form>
            `
        )}

        ${panel('Patient Records', 'View and manage registered patients.',
            '<div id="patientTable"></div>'
        )}
    `;

    document.getElementById('patientForm').addEventListener('submit', addPatient);

    try {
        const patients = await apiRequest('/patients');

        document.getElementById('patientTable').innerHTML = renderTable(
            ['ID', 'Patient Name', 'Age', 'Phone', 'Problem', 'Actions'],
            patients.map(p => `
                <tr>
                    <td>#${escapeHTML(p.id)}</td>
                    <td><strong>${escapeHTML(p.name)}</strong></td>
                    <td>${escapeHTML(p.age)}</td>
                    <td>${escapeHTML(p.phone)}</td>
                    <td>${escapeHTML(p.problem)}</td>
                    <td class="mc-actions">
                        <button class="mc-btn secondary" onclick="editPatient(${Number(p.id)})">Edit</button>
                        <button class="mc-btn danger" onclick="deletePatient(${Number(p.id)})">Delete</button>
                    </td>
                </tr>
            `).join(''),
            6
        );
    } catch (error) {
        notify(error.message);
    }
}

async function addPatient(event) {
    event.preventDefault();

    const data = getFormData(event.target);
    data.name = data.name.trim();
    data.phone = data.phone.trim();
    data.problem = data.problem.trim();
    data.age = Number(data.age);

    if (!data.name || !data.phone || !data.problem ||
        !Number.isInteger(data.age) || data.age < 0 || data.age > 120) {
        return notify('Please enter valid patient details.');
    }

    try {
        const result = await apiRequest('/patients', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        notify(result.message);

        await loadDashboard();
        await renderPatients();
        
    } catch (error) {
        notify(error.message);
    }
}

async function editPatient(id) {
    try {
        const p = await apiRequest('/patients/' + id);

        const name = prompt('Patient name:', p.name);
        if (name === null) return;

        const age = prompt('Patient age:', p.age);
        if (age === null) return;

        const phone = prompt('Phone number:', p.phone);
        if (phone === null) return;

        const problem = prompt('Medical problem:', p.problem);
        if (problem === null) return;

        const result = await apiRequest('/patients/' + id, {
            method: 'PUT',
            body: JSON.stringify({ name, age: Number(age), phone, problem })
        });

        notify(result.message);
        await renderPatients();
    } catch (error) {
        notify(error.message);
    }
}

async function deletePatient(id) {
    if (!confirm('Are you sure you want to delete this patient?')) return;

    try {
        const result = await apiRequest('/patients/' + id, { method: 'DELETE' });
        notify(result.message);
        await renderPatients();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

// DOCTOR MANAGEMENT

async function renderDoctors() {
    const workspace = document.getElementById('workspace');

    workspace.innerHTML = `
        ${panel('Register New Doctor',
            'Add a doctor to the hospital directory.',
            `
            <form id="doctorForm" class="mc-form">
                ${field('Doctor Name', 'name', 'text', 'Enter doctor name')}
                ${field('Specialization', 'specialization', 'text', 'e.g. Cardiologist')}
                ${field('Phone Number', 'phone', 'tel', 'Enter phone number')}
                <div class="mc-field full">
                    <button class="mc-btn" type="submit">+ Add Doctor</button>
                </div>
            </form>
            `
        )}

        ${panel('Doctor Directory', 'Manage registered hospital doctors.',
            '<div id="doctorTable"></div>'
        )}
    `;

    document.getElementById('doctorForm').addEventListener('submit', addDoctor);

    try {
        const doctors = await apiRequest('/doctors');

        document.getElementById('doctorTable').innerHTML = renderTable(
            ['ID', 'Doctor Name', 'Specialization', 'Phone', 'Actions'],
            doctors.map(d => `
                <tr>
                    <td>#${escapeHTML(d.id)}</td>
                    <td><strong>${escapeHTML(d.name)}</strong></td>
                    <td>${escapeHTML(d.specialization)}</td>
                    <td>${escapeHTML(d.phone)}</td>
                    <td class="mc-actions">
                        <button class="mc-btn secondary" onclick="editDoctor(${Number(d.id)})">Edit</button>
                        <button class="mc-btn danger" onclick="deleteDoctor(${Number(d.id)})">Delete</button>
                    </td>
                </tr>
            `).join(''),
            5
        );
    } catch (error) {
        notify(error.message);
    }
}

async function addDoctor(event) {
    event.preventDefault();

    const data = getFormData(event.target);

    try {
        const result = await apiRequest('/doctors', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        notify(result.message);
        await renderDoctors();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function editDoctor(id) {
    try {
        const d = await apiRequest('/doctors/' + id);

        const name = prompt('Doctor name:', d.name);
        if (name === null) return;

        const specialization = prompt('Specialization:', d.specialization);
        if (specialization === null) return;

        const phone = prompt('Phone number:', d.phone);
        if (phone === null) return;

        const result = await apiRequest('/doctors/' + id, {
            method: 'PUT',
            body: JSON.stringify({ name, specialization, phone })
        });

        notify(result.message);
        await renderDoctors();
    } catch (error) {
        notify(error.message);
    }
}

async function deleteDoctor(id) {
    if (!confirm('Delete this doctor?')) return;

    try {
        const result = await apiRequest('/doctors/' + id, { method: 'DELETE' });
        notify(result.message);
        await renderDoctors();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

// APPOINTMENT MANAGEMENT

async function renderAppointments() {
    const workspace = document.getElementById('workspace');

    workspace.innerHTML = `
        ${panel('Book New Appointment',
            'Choose a patient, doctor and appointment time.',
            `
            <form id="appointmentForm" class="mc-form">
                <div class="mc-field">
                    <label>Patient *</label>
                    <select name="patient_id" id="patientSelect" required>
                        <option value="">Select patient</option>
                    </select>
                </div>
                <div class="mc-field">
                    <label>Doctor *</label>
                    <select name="doctor_id" id="doctorSelect" required>
                        <option value="">Select doctor</option>
                    </select>
                </div>
                ${field('Appointment Date', 'date', 'date')}
                ${field('Appointment Time', 'time', 'time')}
                <div class="mc-field full">
                    <button class="mc-btn" type="submit">+ Book Appointment</button>
                </div>
            </form>
            `
        )}

        ${panel('Appointment Records',
            'Update appointment status and manage bookings.',
            '<div id="appointmentTable"></div>'
        )}
    `;

    const dateInput = document.querySelector('#appointmentForm [name="date"]');
    const now = new Date();
    const localToday = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-');
    dateInput.min = localToday;

    try {
        const [patients, doctors, appointments] = await Promise.all([
            apiRequest('/patients'),
            apiRequest('/doctors'),
            apiRequest('/appointments')
        ]);

        document.getElementById('patientSelect').innerHTML += patients.map(p => `
            <option value="${p.id}">${escapeHTML(p.name)} (#${p.id})</option>
        `).join('');

        document.getElementById('doctorSelect').innerHTML += doctors.map(d => `
            <option value="${d.id}">${escapeHTML(d.name)} - ${escapeHTML(d.specialization)}</option>
        `).join('');

        document.getElementById('appointmentForm')
            .addEventListener('submit', addAppointment);

        document.getElementById('appointmentTable').innerHTML = renderTable(
            ['Patient', 'Doctor', 'Date', 'Time', 'Status', 'Actions'],
            appointments.map(a => `
                <tr>
                    <td>${escapeHTML(a.patient_name)}</td>
                    <td>${escapeHTML(a.doctor_name)}</td>
                    <td>${escapeHTML(a.date)}</td>
                    <td>${escapeHTML(a.time)}</td>
                    <td>
                        <select onchange="updateAppointmentStatus(${Number(a.id)}, this.value)">
                            ${['Scheduled', 'Completed', 'Cancelled'].map(s =>
                                `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td class="mc-actions">
                        <button class="mc-btn secondary" onclick="editAppointment(${Number(a.id)})">Edit</button>
                        <button class="mc-btn danger" onclick="deleteAppointment(${Number(a.id)})">Delete</button>
                    </td>
                </tr>
            `).join(''),
            6
        );
    } catch (error) {
        notify(error.message);
    }
}

async function addAppointment(event) {
    event.preventDefault();

    const data = getFormData(event.target);

    try {
        const result = await apiRequest('/appointments', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        notify(result.message);
        await renderAppointments();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function updateAppointmentStatus(id, status) {
    try {
        const result = await apiRequest(`/appointments/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });

        notify(result.message);
        await loadDashboard();
    } catch (error) {
        notify(error.message);
        await renderAppointments();
    }
}

async function editAppointment(id) {
    try {
        const appointments = await apiRequest('/appointments');
        const a = appointments.find(item => item.id === id);

        if (!a) return notify('Appointment not found.');

        const date = prompt('Appointment date (YYYY-MM-DD):', a.date);
        if (date === null) return;

        const time = prompt('Appointment time (HH:MM):', a.time);
        if (time === null) return;

        const result = await apiRequest('/appointments/' + id, {
            method: 'PUT',
            body: JSON.stringify({
                patient_id: a.patient_id,
                doctor_id: a.doctor_id,
                date,
                time,
                status: a.status
            })
        });

        notify(result.message);
        await renderAppointments();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function deleteAppointment(id) {
    if (!confirm('Permanently delete this appointment?')) return;

    try {
        const result = await apiRequest('/appointments/' + id, {
            method: 'DELETE'
        });

        notify(result.message);
        await renderAppointments();
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

// BILLING MANAGEMENT

async function renderBilling() {
    const workspace = document.getElementById('workspace');

    workspace.innerHTML = `
        ${panel('Generate Patient Bill',
            'Create a bill for consultation and treatment.',
            `
            <form id="billForm" class="mc-form">
                <div class="mc-field full">
                    <label>Patient *</label>
                    <select name="patient_id" id="billPatient" required>
                        <option value="">Select patient</option>
                    </select>
                </div>
                <div class="mc-field full">
                    <label>Related Appointment (optional)</label>
                    <select name="appointment_id" id="billAppointment">
                        <option value="">No linked appointment</option>
                    </select>
                </div>
                ${field('Consultation Fee (₹)', 'consultation_fee', 'number', '0')}
                ${field('Treatment Charges (₹)', 'treatment_charges', 'number', '0')}
                <div class="mc-field full">
                    <button class="mc-btn" type="submit">+ Generate Bill</button>
                </div>
            </form>
            `
        )}

        ${panel('Billing Records',
            'View bills and update payment status.',
            '<div id="billTable"></div>'
        )}
    `;

    try {
        const [patients, appointments, bills] = await Promise.all([
            apiRequest('/patients'),
            apiRequest('/appointments'),
            apiRequest('/bills')
        ]);

        document.getElementById('billPatient').innerHTML += patients.map(p => `
            <option value="${p.id}">${escapeHTML(p.name)} (#${p.id})</option>
        `).join('');

        document.getElementById('billAppointment').innerHTML += appointments.map(a => `
            <option value="${a.id}">${escapeHTML(a.patient_name)} - ${escapeHTML(a.date)} ${escapeHTML(a.time)}</option>
        `).join('');

        document.getElementById('billForm').addEventListener('submit', addBill);

        document.getElementById('billTable').innerHTML = renderTable(
            ['Bill ID', 'Patient', 'Consultation', 'Treatment', 'Total', 'Payment', 'Action'],
            bills.map(b => `
                <tr>
                    <td>#${escapeHTML(b.id)}</td>
                    <td>${escapeHTML(b.patient_name)}</td>
                    <td>₹${Number(b.consultation_fee).toFixed(2)}</td>
                    <td>₹${Number(b.treatment_charges).toFixed(2)}</td>
                    <td><strong>₹${Number(b.total).toFixed(2)}</strong></td>
                    <td><span class="mc-status ${escapeHTML(b.payment_status)}">${escapeHTML(b.payment_status)}</span></td>
                    <td>
                        <button class="mc-btn"
                            onclick="updateBillPayment(${Number(b.id)}, '${b.payment_status === 'Paid' ? 'Pending' : 'Paid'}')">
                            Mark ${b.payment_status === 'Paid' ? 'Pending' : 'Paid'}
                        </button>
                    </td>
                </tr>
            `).join(''),
            7
        );

    } catch (error) {
        notify(error.message);
    }
}

async function addBill(event) {
    event.preventDefault();

    const data = getFormData(event.target);

    data.consultation_fee = Number(data.consultation_fee);
    data.treatment_charges = Number(data.treatment_charges);

    if (data.appointment_id === '') delete data.appointment_id;

    if (data.consultation_fee < 0 || data.treatment_charges < 0 ||
        !Number.isFinite(data.consultation_fee) ||
        !Number.isFinite(data.treatment_charges)) {
        return notify('Enter valid billing amounts.');
    }

    try {
        const result = await apiRequest('/bills', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        notify(`${result.message} Total: ₹${result.total.toFixed(2)}`);
        await renderBilling();
    } catch (error) {
        notify(error.message);
    }
}

async function updateBillPayment(id, status) {
    if (!confirm(`Change payment status to ${status}?`)) return;

    try {
        const result = await apiRequest(`/bills/${id}/payment`, {
            method: 'PATCH',
            body: JSON.stringify({ payment_status: status })
        });

        notify(result.message);
        await renderBilling();
    } catch (error) {
        notify(error.message);
    }
}

// GLOBAL SEARCH
function setupSearch() {
    const search = document.getElementById('globalSearch');
    if (!search) return;

    search.addEventListener('input', event => {
        const query = event.target.value.toLowerCase();

        document.querySelectorAll('#workspace tbody tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(query)
                ? ''
                : 'none';
        });
    });
}

// NAVIGATION EVENTS
document.addEventListener('click', event => {
    const link = event.target.closest('.nav-link');

    if (link) {
        event.preventDefault();
        showSection(link.dataset.section);
    }

    const quickAction = event.target.closest('[data-go]');

    if (quickAction) {
        showSection(quickAction.dataset.go);
    }
});

// START APPLICATION
injectStyles();
addBillingNavigation();
setupSearch();
loadDashboard();
refreshIcons();
