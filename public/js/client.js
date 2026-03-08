(function () {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // State
    const state = {
        token: new URLSearchParams(window.location.search).get('token'),
        client: {},
        vouchers: [],
        currentTab: 'all'
    };

    // Initialize
    async function init() {
        if (!state.token) {
            $('#loader-view').innerHTML = '<p style="color:red;">Acceso denegado: Token no encontrado.</p>';
            return;
        }

        try {
            const res = await fetch(`/api/client-portal/portal?token=${state.token}`).then(r => r.json());
            if (res.success) {
                state.client = res.client;
                state.vouchers = res.vouchers;

                renderClientInfo();
                renderStats();
                renderVouchers();

                $('#loader-view').classList.add('hidden');
                $('#main-view').classList.remove('hidden');
            } else {
                $('#loader-view').innerHTML = `<p style="color:red;">Error: ${res.error}</p>`;
            }
        } catch (err) {
            $('#loader-view').innerHTML = '<p style="color:red;">Error de conexión al servidor.</p>';
        }

        bindEvents();
    }

    function bindEvents() {
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentTab = btn.dataset.tab;
                renderVouchers();
            });
        });

        $('#send-form').addEventListener('submit', handleAssign);
    }

    function renderClientInfo() {
        $('#client-name').textContent = state.client.name;
        $('#client-id').textContent = state.client.trade_name || 'Portal de Vales';
    }

    function renderStats() {
        const active = state.vouchers.filter(v => v.current_value > 0 && !v.is_expired).length;
        const totalValue = state.vouchers.reduce((acc, v) => acc + v.current_value, 0);

        $('#stat-count').textContent = active;
        $('#stat-value').textContent = `$${totalValue.toFixed(2)}`;
    }

    function renderVouchers() {
        const wrap = $('#vouchers-wrap');
        wrap.innerHTML = '';

        let filtered = state.vouchers;
        if (state.currentTab === 'assigned') {
            filtered = state.vouchers.filter(v => v.recipient_name);
        }

        if (filtered.length === 0) {
            $('#empty-state').classList.remove('hidden');
            return;
        }

        $('#empty-state').classList.add('hidden');

        filtered.forEach(v => {
            const card = document.createElement('div');
            card.className = 'voucher-card';

            const isUsed = v.current_value <= 0;
            const isExpired = v.is_expired;
            let status = 'Activo', sClass = 'status-active';

            if (isUsed) { status = 'Consumido'; sClass = 'status-used'; }
            else if (isExpired) { status = 'Vencido'; sClass = 'status-expired'; }

            card.innerHTML = `
                <div class="v-header">
                    <span class="v-value">$${v.initial_value.toFixed(2)}</span>
                    <span class="v-status ${sClass}">${status}</span>
                </div>
                <div class="v-details">
                    <p>Saldo: <strong>$${v.current_value.toFixed(2)}</strong></p>
                    <p>Vence: ${new Date(v.expiry_date).toLocaleDateString()}</p>
                </div>
                ${v.recipient_name ? `
                <div class="v-recipient">
                    <strong>👤 ${v.recipient_name}</strong>
                    <span>${v.recipient_contact || ''}</span>
                </div>` : ''}
                <div class="v-actions">
                    <button class="btn btn-primary btn-sm btn-view-qr" ${isExpired ? 'disabled' : ''}>Ver QR</button>
                    <button class="btn btn-ghost btn-sm btn-assign" ${isUsed || isExpired ? 'disabled' : ''}>${v.recipient_name ? 'Re-enviar' : 'Repartir'}</button>
                </div>
            `;

            card.querySelector('.btn-view-qr').addEventListener('click', () => showQRModal(v));
            card.querySelector('.btn-assign').addEventListener('click', () => openAssignModal(v));

            wrap.appendChild(card);
        });
    }

    function showQRModal(v) {
        $('#qr-value').textContent = `$${v.current_value.toFixed(2)}`;
        const qrContainer = $('#qr-container');
        qrContainer.innerHTML = '';

        const qr = qrcode(0, 'M');
        qr.addData(v.qr_payload);
        qr.make();
        qrContainer.innerHTML = qr.createImgTag(5);

        $('#qr-modal').classList.add('active');
    }

    function openAssignModal(v) {
        $('#send-voucher-id').value = v.id;
        $('#recipient-name').value = v.recipient_name || '';
        $('#recipient-contact').value = v.recipient_contact || '';
        $('#send-modal').classList.add('active');
    }

    async function handleAssign(e) {
        e.preventDefault();
        const data = {
            token: state.token,
            voucher_id: $('#send-voucher-id').value,
            recipient_name: $('#recipient-name').value,
            recipient_contact: $('#recipient-contact').value
        };

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;

        try {
            const res = await fetch('/api/client-portal/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json());

            if (res.success) {
                // Update local state
                const v = state.vouchers.find(v => v.id === data.voucher_id);
                if (v) {
                    v.recipient_name = data.recipient_name;
                    v.recipient_contact = data.recipient_contact;
                }

                closeModal('send-modal');
                renderVouchers();

                // Mock distribution (WhatsApp link)
                if (data.recipient_contact) {
                    const msg = encodeURIComponent(`Hola ${data.recipient_name}, tu empleador te ha enviado un pase de consumo de Pollo Campero por $${v.initial_value.toFixed(2)}. Puedes usarlo aquí: ${window.location.href}`);
                    if (data.recipient_contact.includes('+') || !isNaN(data.recipient_contact)) {
                        window.open(`https://wa.me/${data.recipient_contact.replace(/\D/g, '')}?text=${msg}`);
                    }
                }
            }
        } catch (err) {
            alert('Error al guardar asignación');
        } finally {
            btn.disabled = false;
        }
    }

    window.closeModal = function (id) {
        $(`#${id}`).classList.remove('active');
    }

    init();
})();
