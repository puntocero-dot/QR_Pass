(function () {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const state = {
        token: localStorage.getItem('company_portal_token'),
        client: JSON.parse(localStorage.getItem('company_portal_client') || 'null'),
        vouchers: [],
        currentTab: 'all',
        bulkData: []
    };

    async function init() {
        if (state.token && state.client) {
            showPortal();
        } else {
            $('#login-section').classList.remove('hidden');
            $('#main-view').classList.add('hidden');
        }
        bindEvents();
    }

    function bindEvents() {
        $('#portal-login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = $('#portal-identifier').value;
            const password = $('#portal-password').value;
            const errorEl = $('#login-error');

            try {
                const res = await fetch('/api/client-portal/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, password })
                }).then(r => r.json());

                if (res.success) {
                    state.token = res.token;
                    state.client = res.client;
                    localStorage.setItem('company_portal_token', res.token);
                    localStorage.setItem('company_portal_client', JSON.stringify(res.client));
                    showPortal();
                } else {
                    errorEl.textContent = res.error || 'Credenciales incorrectas';
                    errorEl.classList.remove('hidden');
                }
            } catch (err) {
                errorEl.textContent = 'Error de conexión';
                errorEl.classList.remove('hidden');
            }
        });

        $('#btn-logout').addEventListener('click', () => {
            localStorage.removeItem('company_portal_token');
            localStorage.removeItem('company_portal_client');
            location.reload();
        });

        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentTab = btn.dataset.tab;
                renderVouchers();
            });
        });

        $('#bulk-csv').addEventListener('change', handleFileSelect);
        $('#btn-process-bulk').addEventListener('click', processBulkList);
        $('#btn-confirm-bulk').addEventListener('click', confirmBulkAssignment);
        $('#send-form').addEventListener('submit', handleSingleAssign);
    }

    async function showPortal() {
        $('#login-section').classList.add('hidden');
        $('#main-view').classList.remove('hidden');
        $('#client-name').textContent = state.client.name;
        loadVouchers();
    }

    async function loadVouchers() {
        try {
            const res = await fetch('/api/client-portal/portal', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());

            if (res.success) {
                state.vouchers = res.vouchers;
                renderStats();
                renderVouchers();
            } else if (res.code === 'TOKEN_EXPIRED') {
                localStorage.removeItem('company_portal_token');
                location.reload();
            }
        } catch (e) { console.error('Load error', e); }
    }

    function renderStats() {
        const active = state.vouchers.filter(v => v.current_value > 0).length;
        const total = state.vouchers.reduce((a, v) => a + v.current_value, 0);
        $('#stat-count').textContent = active;
        $('#stat-value').textContent = `$${total.toFixed(2)}`;
    }

    function renderVouchers() {
        const wrap = $('#vouchers-list');
        wrap.innerHTML = '';
        
        let filtered = state.vouchers;
        if (state.currentTab === 'assigned') {
            filtered = state.vouchers.filter(v => v.recipient_contact);
        }

        if (filtered.length === 0) {
            $('#empty-state').classList.remove('hidden');
            return;
        }
        $('#empty-state').classList.add('hidden');

        filtered.forEach(v => {
            const card = document.createElement('div');
            card.className = 'card voucher-item';
            const isUsed = v.current_value <= 0;
            
            card.innerHTML = `
                <div class="voucher-info">
                    <strong>$${v.initial_value.toFixed(2)}</strong>
                    <span class="badge ${v.recipient_contact ? 'badge-info' : 'badge-success'}">
                        ${v.recipient_contact ? 'Asignado' : 'Disponible'}
                    </span>
                    <p>Saldo: $${v.current_value.toFixed(2)}</p>
                    ${v.recipient_contact ? `<p class="recipient-info">Enviado a: ${v.recipient_contact}</p>` : ''}
                </div>
                <div class="voucher-actions">
                    <button class="btn btn-ghost btn-sm" onclick="openQR('${v.id}')">QR</button>
                    <button class="btn btn-primary btn-sm" onclick="openAssign('${v.id}')" ${isUsed ? 'disabled' : ''}>
                        ${v.recipient_contact ? 'Re-enviar' : 'Asignar'}
                    </button>
                </div>
            `;
            wrap.appendChild(card);
        });
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.bulkData = ev.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            $('#btn-process-bulk').disabled = false;
        };
        reader.readAsText(file);
    }

    function processBulkList() {
        const available = state.vouchers.filter(v => v.current_value > 0 && !v.recipient_contact).length;
        const count = Math.min(state.bulkData.length, available);
        $('#bulk-stats').textContent = `Documento: ${state.bulkData.length} registros. Disponibles: ${available}. Se asignarán: ${count}.`;
        $('#bulk-preview').classList.remove('hidden');
    }

    async function confirmBulkAssignment() {
        const available = state.vouchers.filter(v => v.current_value > 0 && !v.recipient_contact);
        const assignments = state.bulkData.slice(0, available.length).map((contact, i) => ({
            voucher_id: available[i].id,
            contact
        }));

        const res = await fetch('/api/client-portal/assign-bulk', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ assignments })
        }).then(r => r.json());

        if (res.success) {
            alert('Vales asignados con éxito');
            $('#bulk-preview').classList.add('hidden');
            loadVouchers();
        }
    }

    async function handleSingleAssign(e) {
        e.preventDefault();
        const id = $('#send-voucher-id').value;
        const contact = $('#recipient-contact').value;

        const res = await fetch('/api/client-portal/assign', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ voucher_id: id, recipient_contact: contact })
        }).then(r => r.json());

        if (res.success) {
            $('#send-modal').classList.remove('active');
            loadVouchers();
        }
    }

    window.openAssign = (id) => {
        $('#send-voucher-id').value = id;
        $('#send-modal').classList.add('active');
    };

    window.openQR = (id) => {
        const v = state.vouchers.find(v => v.id === id);
        // Show QR logic...
    };

    init();
})();
