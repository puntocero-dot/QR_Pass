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
            // Redirect to unified login on main page if not authenticated
            location.href = '/index.html';
        }
        bindEvents();
    }

    function bindEvents() {
        // Redundant login form removed from HTML

        const logoutBtn = $('#btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.clear();
                location.href = '/index.html';
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
        const active = state.vouchers.filter(v => Number(v.current_value) > 0 && !v.recipient_contact).length;
        const total = state.vouchers.reduce((a, v) => a + Number(v.current_value), 0);
        const assigned = state.vouchers.filter(v => v.recipient_contact && v.recipient_contact.trim().length > 0).length;
        
        $('#stat-count').textContent = active;
        const statAssigned = $('#stat-assigned');
        if (statAssigned) statAssigned.textContent = assigned;
        $('#stat-value').textContent = `$${Number(total).toFixed(2)}`;
    }

    // ... keeping other functions identical ...

    // Redefining renderVouchers to match original
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
            card.className = 'glass-card fade-in';
            card.style.padding = '24px';
            const isUsed = Number(v.current_value) <= 0;
            const isExpired = v.is_expired;
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                    <span style="font-size: 1.5rem; font-weight: 800; color: var(--premium-accent); font-family: var(--font-heading);">$${Number(v.initial_value).toFixed(2)}</span>
                    <span style="font-size: 0.7rem; padding: 4px 10px; border-radius: 6px; font-weight: 700; text-transform: uppercase; background: rgba(255,255,255,0.05); color: ${isUsed ? '#888' : (isExpired ? '#f44336' : '#4caf50')}">
                        ${isUsed ? 'Consumido' : (isExpired ? 'Expirado' : 'Activo')}
                    </span>
                </div>
                <div style="margin-bottom: 20px;">
                    <p style="font-size: 0.85rem; color: rgba(255,255,255,0.5);">Saldo: <strong style="color: white;">$${Number(v.current_value).toFixed(2)}</strong></p>
                    <p style="font-size: 0.85rem; color: rgba(255,255,255,0.3);">Vence: ${new Date(v.expiry_date).toLocaleDateString()}</p>
                </div>
                ${v.recipient_contact ? `
                    <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border-left: 3px solid var(--premium-accent); margin-bottom: 20px;">
                        <strong style="display: block; font-size: 0.85rem;">Para: ${v.recipient_name || 'Empleado'}</strong>
                        <span style="font-size: 0.75rem; color: rgba(255,255,255,0.4);">${v.recipient_contact}</span>
                    </div>
                ` : ''}
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button class="premium-btn" style="padding: 10px; font-size: 0.75rem;" onclick="openQR('${v.id}')">VER QR</button>
                    <button class="btn btn-ghost" style="font-size: 0.75rem;" onclick="openAssign('${v.id}')">
                        ${v.recipient_contact ? 'EDITAR' : 'ASIGNAR'}
                    </button>
                    <button class="btn btn-ghost" style="padding: 8px; font-size: 0.65rem;" onclick="shareVoucher('${v.id}', 'wa')" ${isUsed || !v.recipient_contact ? 'disabled' : ''}>
                        WHATSAPP
                    </button>
                    <button class="btn btn-ghost" style="padding: 8px; font-size: 0.65rem;" onclick="shareVoucher('${v.id}', 'mail')" ${isUsed || !v.recipient_contact ? 'disabled' : ''}>
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
        $('#qr-modal').classList.remove('hidden');
    };

    window.closeModal = (id) => {
        $(`#${id}`).classList.add('hidden');
    };

    window.shareVoucher = async (id, type) => {
        const v = state.vouchers.find(v => v.id === id);
        if (!v) return;

        const publicLink = `${window.location.protocol}//${window.location.host}/vale.html?id=${id}`;
        
        if (type === 'wa') {
            const message = `Hola ${v.recipient_name || ''}, aquí tienes tu vale de consumo por $${Number(v.initial_value).toFixed(2)} de ${v.issuing_company_name}.\n\nÁbrelo y mira tu saldo en vivo aquí: ${publicLink}`;
            const url = `https://wa.me/${v.recipient_contact.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
            window.open(url, '_blank');
        } else {
            // Send email using backend (which uses Resend)
            try {
                const btn = document.activeElement;
                const originalText = btn ? btn.textContent : '';
                if (btn) btn.textContent = 'Enviando...';

                const res = await fetch('/api/client-portal/send-email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}`
                    },
                    body: JSON.stringify({ voucher_id: id })
                }).then(r => r.json());

                if (res.success) {
                    alert('Correo enviado con éxito (vía Resend)');
                } else {
                    alert('Error enviando correo: ' + res.error);
                }
                if (btn) btn.textContent = originalText;
            } catch (err) {
                alert('Error de conexión al enviar email');
            }
        }
    };

    window.openAssign = (id) => {
        const v = state.vouchers.find(v => v.id === id);
        $('#send-voucher-id').value = id;
        $('#recipient-name').value = v.recipient_name || '';
        $('#recipient-contact').value = v.recipient_contact || '';
        if ($('#assign-error')) $('#assign-error').classList.add('hidden');
        $('#send-modal').classList.remove('hidden');
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
            const btn = $('#btn-confirm-bulk');
            const originalText = btn.textContent;
            btn.textContent = '✅ Vales asignados';
            btn.style.background = 'var(--success)';
            setTimeout(() => {
                $('#bulk-preview').classList.add('hidden');
                btn.textContent = originalText;
                btn.style.background = '';
                loadVouchers();
            }, 2000);
        }
    }

    async function handleSingleAssign(e) {
        e.preventDefault();
        const btn = e.submitter || $('#btn-save-assign');
        if (btn) btn.disabled = true;

        const id = $('#send-voucher-id').value;
        const contact = $('#recipient-contact').value.trim();
        const name = $('#recipient-name').value.trim();
        const errEl = $('#assign-error');

        // Validation for duplicates
        const isDuplicate = state.vouchers.some(v => 
            v.id !== id && 
            ((contact && v.recipient_contact === contact) || 
             (name && v.recipient_name && v.recipient_name.toLowerCase() === name.toLowerCase()))
        );

        if (isDuplicate) {
            if (errEl) {
                errEl.textContent = 'Este empleado o contacto ya tiene un vale asignado.';
                errEl.classList.remove('hidden');
            }
            if (btn) btn.disabled = false;
            return;
        }

        if (errEl) errEl.classList.add('hidden');

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
                await loadVouchers();
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = '✅ Guardado';
                    btn.style.background = 'var(--success)';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.background = ''; // reset
                        $('#send-modal').classList.add('hidden');
                        if (btn) btn.disabled = false;
                    }, 1500);
                } else {
                    $('#send-modal').classList.add('hidden');
                }
            } else {
                if (errEl) {
                    errEl.textContent = res.error || 'Error al asignar';
                    errEl.classList.remove('hidden');
                }
                if (btn) btn.disabled = false;
            }
        } catch (e) {
            if (errEl) {
                errEl.textContent = 'Error de conexión';
                errEl.classList.remove('hidden');
            }
            if (btn) btn.disabled = false;
        }
    }

    init();
})();
