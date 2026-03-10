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
            $('#loader-view').classList.add('hidden');
            $('#login-section').classList.remove('hidden');
            $('#main-view').classList.add('hidden');
        }
        bindEvents();
    }

    function bindEvents() {
        $('#portal-login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = $('#portal-username').value;
            const password = $('#portal-password').value;
            const errorEl = $('#login-error');

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                }).then(r => r.json());

                if (res.success && res.user.role === 'client') {
                    state.token = res.token;
                    state.client = res.user;
                    localStorage.setItem('company_portal_token', res.token);
                    localStorage.setItem('company_portal_client', JSON.stringify(res.user));
                    showPortal();
                } else if (res.success) {
                    errorEl.textContent = 'Este usuario no tiene acceso al portal de clientes';
                    errorEl.classList.remove('hidden');
                } else {
                    errorEl.textContent = res.error || 'Credenciales incorrectas';
                    errorEl.classList.remove('hidden');
                }
            } catch (err) {
                errorEl.textContent = 'Error de conexión';
                errorEl.classList.remove('hidden');
            }
        });

        const logoutBtn = $('#btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('company_portal_token');
                localStorage.removeItem('company_portal_client');
                location.reload();
            });
        }

        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentTab = btn.dataset.tab;
                renderVouchers();
            });
        });

        const bulkBtn = $('#btn-process-bulk');
        if (bulkBtn) bulkBtn.addEventListener('click', processBulkList);
        
        const bulkConfirmBtn = $('#btn-confirm-bulk');
        if (bulkConfirmBtn) bulkConfirmBtn.addEventListener('click', confirmBulkAssignment);
        
        const sendForm = $('#send-form');
        if (sendForm) sendForm.addEventListener('submit', handleSingleAssign);

        const bulkCsv = $('#bulk-csv');
        if (bulkCsv) bulkCsv.addEventListener('change', handleFileSelect);
    }

    async function showPortal() {
        $('#loader-view').classList.add('hidden');
        $('#login-section').classList.add('hidden');
        $('#main-view').classList.remove('hidden');
        $('#client-name').textContent = state.client.full_name || state.client.company_name;
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
        const active = state.vouchers.filter(v => Number(v.current_value) > 0).length;
        const total = state.vouchers.reduce((a, v) => a + Number(v.current_value), 0);
        $('#stat-count').textContent = active;
        $('#stat-value').textContent = `$${Number(total).toFixed(2)}`;
    }

    function renderVouchers() {
        const wrap = $('#vouchers-list');
        wrap.innerHTML = '';
        
        let filtered = state.vouchers;
        if (state.currentTab === 'assigned') {
            filtered = state.vouchers.filter(v => v.recipient_contact && v.recipient_contact.trim().length > 0);
        }

        if (state.vouchers.length === 0) {
            $('#empty-state').classList.remove('hidden');
            return;
        }
        $('#empty-state').classList.add('hidden');

        filtered.forEach(v => {
            const card = document.createElement('div');
            card.className = 'voucher-card fade-in';
            const isUsed = Number(v.current_value) <= 0;
            const isExpired = v.is_expired;
            
            card.innerHTML = `
                <div class="v-header">
                    <span class="v-value">$${Number(v.initial_value).toFixed(2)}</span>
                    <span class="v-status ${isUsed ? 'status-used' : (isExpired ? 'status-expired' : 'status-active')}">
                        ${isUsed ? 'Consumido' : (isExpired ? 'Expirado' : 'Activo')}
                    </span>
                </div>
                <div class="v-details">
                    <p>Saldo actual: <strong>$${Number(v.current_value).toFixed(2)}</strong></p>
                    <p>Expira: ${new Date(v.expiry_date).toLocaleDateString()}</p>
                </div>
                ${v.recipient_contact ? `
                    <div class="v-recipient">
                        <strong>Para: ${v.recipient_name || 'Empleado'}</strong>
                        <span>${v.recipient_contact}</span>
                    </div>
                ` : ''}
                <div class="v-actions">
                    <button class="btn btn-primary" onclick="openQR('${v.id}')">VER QR</button>
                    <button class="btn btn-ghost" onclick="openAssign('${v.id}')">
                        ${v.recipient_contact ? 'EDITAR' : 'ASIGNAR'}
                    </button>
                    <button class="btn btn-ghost" onclick="shareVoucher('${v.id}', 'wa')" ${isUsed || !v.recipient_contact ? 'disabled' : ''}>
                        WHATSAPP
                    </button>
                    <button class="btn btn-ghost" onclick="shareVoucher('${v.id}', 'mail')" ${isUsed || !v.recipient_contact ? 'disabled' : ''}>
                        EMAIL
                    </button>
                </div>
            `;
            wrap.appendChild(card);
        });
    }

    window.openQR = (id) => {
        const v = state.vouchers.find(v => v.id === id);
        if (!v) return;

        $('#qr-container').innerHTML = '';
        const qr = qrcode(0, 'H'); // Higher error correction
        qr.addData(v.qr_payload);
        qr.make();
        
        $('#qr-container').innerHTML = qr.createImgTag(8);
        $('#qr-value').textContent = `$${Number(v.current_value).toFixed(2)}`;
        $('#qr-modal').classList.add('active');
    };

    window.closeModal = (id) => {
        $(`#${id}`).classList.remove('active');
    };

    window.shareVoucher = (id, type) => {
        const v = state.vouchers.find(v => v.id === id);
        if (!v) return;

        const message = `Hola ${v.recipient_name || ''}, aquí tienes tu vale de consumo por $${Number(v.initial_value).toFixed(2)}. Saldo: $${Number(v.current_value).toFixed(2)}. Presenta este código QR para canjearlo.`;
        
        if (type === 'wa') {
            const url = `https://wa.me/${v.recipient_contact.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
            window.open(url, '_blank');
        } else {
            const url = `mailto:${v.recipient_contact}?subject=Tu Vale QR&body=${encodeURIComponent(message)}`;
            window.location.href = url;
        }
    };

    window.openAssign = (id) => {
        const v = state.vouchers.find(v => v.id === id);
        $('#send-voucher-id').value = id;
        $('#recipient-name').value = v.recipient_name || '';
        $('#recipient-contact').value = v.recipient_contact || '';
        $('#send-modal').classList.add('active');
    };

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
        const btn = e.submitter || $('#btn-save-assign');
        if (btn) btn.disabled = true;

        const id = $('#send-voucher-id').value;
        const contact = $('#recipient-contact').value;
        const name = $('#recipient-name').value;

        try {
            const res = await fetch('/api/client-portal/assign', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({ 
                    voucher_id: id, 
                    recipient_contact: contact, 
                    recipient_name: name 
                })
            }).then(r => r.json());

            if (res.success) {
                $('#send-modal').classList.remove('active');
                await loadVouchers();
                alert('Asignación guardada con éxito');
            } else {
                alert(res.error || 'Error al asignar');
            }
        } catch (e) {
            alert('Error de conexión');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    init();
})();
