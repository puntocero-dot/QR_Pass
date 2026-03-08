(function () {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const state = {
        token: localStorage.getItem('restaurantes_token'),
        user: JSON.parse(localStorage.getItem('restaurantes_user') || 'null'),
        currentVoucher: null,
        scanner: null
    };

    function init() {
        if (state.token && state.user) {
            if (state.user.role === 'admin' || state.user.role === 'vendor') {
                location.href = '/admin.html';
                return;
            }
            showApp();
        }
        bindEvents();
    }

    function bindEvents() {
        $('#btn-start-login').addEventListener('click', () => switchView('login'));
        
        $('#login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = $('#login-user').value;
            const password = $('#login-pass').value;
            const errorEl = $('#login-error');
            const btn = $('#btn-login');

            btn.disabled = true;
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                }).then(r => r.json());

                if (res.success) {
                    state.token = res.token;
                    state.user = res.user;
                    localStorage.setItem('restaurantes_token', res.token);
                    localStorage.setItem('restaurantes_user', JSON.stringify(res.user));
                    
                    if (res.user.role === 'admin' || res.user.role === 'vendor') location.href = '/admin.html';
                    else showApp();
                } else {
                    errorEl.textContent = res.error;
                    errorEl.classList.remove('hidden');
                }
            } catch (err) {
                errorEl.textContent = 'Error de conexión';
                errorEl.classList.remove('hidden');
            } finally { btn.disabled = false; }
        });

        $('#btn-logout-header').addEventListener('click', handleLogout);

        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view) switchView(view);
            });
        });

        $('#btn-manual-validate').addEventListener('click', () => {
            const code = $('#manual-code').value;
            if (code) validateVoucher(code);
        });

        $('#btn-redeem').addEventListener('click', () => {
            const amount = parseFloat($('#redeem-amount').value);
            if (!amount || amount <= 0 || amount > state.currentVoucher.current_value) {
                alert('Monto inválido');
                return;
            }
            $('#confirm-body').innerHTML = `Vas a canjear <strong>$${amount.toFixed(2)}</strong> del vale de <strong>${state.currentVoucher.issuing_company_name}</strong>.`;
            $('#confirm-modal').classList.remove('hidden');
        });

        $('#btn-confirm-cancel').addEventListener('click', () => $('#confirm-modal').classList.add('hidden'));
        
        $('#btn-confirm-ok').addEventListener('click', handleRedeem);

        $('#btn-new-scan').addEventListener('click', () => switchView('scanner'));
        $('#btn-cancel-voucher').addEventListener('click', () => switchView('scanner'));
    }

    function switchView(viewId) {
        $$('.view').forEach(v => v.classList.remove('active'));
        $(`#view-${viewId}`).classList.add('active');

        // Update nav
        $$('.nav-item').forEach(b => b.classList.remove('active'));
        const navBtn = $(`.nav-item[data-view="${viewId}"]`);
        if (navBtn) navBtn.classList.add('active');

        if (viewId === 'scanner') startScanner();
        else stopScanner();

        if (viewId === 'cuadre') loadCuadre();
    }

    function showApp() {
        $('#app-header').classList.remove('hidden');
        $('#bottom-nav').classList.remove('hidden');
        $('#restaurant-name').textContent = state.user.restaurant_name || 'Restaurante';
        switchView('scanner');
    }

    function handleLogout() {
        localStorage.clear();
        location.reload();
    }

    async function validateVoucher(payload) {
        try {
            const res = await fetch('/api/vouchers/validate', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({ payload })
            }).then(r => r.json());

            if (res.success) {
                state.currentVoucher = res.voucher;
                showVoucher();
            } else {
                alert(res.error || 'Vale inválido');
            }
        } catch (e) { alert('Error de conexión'); }
    }

    function showVoucher() {
        const v = state.currentVoucher;
        $('#voucher-company').textContent = v.issuing_company_name;
        $('#voucher-balance').textContent = `$${v.current_value.toFixed(2)}`;
        $('#voucher-expiry').textContent = new Date(v.expiry_date).toLocaleDateString();
        $('#redeem-amount').value = v.current_value.toFixed(2);
        switchView('voucher');
    }

    async function handleRedeem() {
        const amount = parseFloat($('#redeem-amount').value);
        const invoice = $('#invoice-number').value;

        $('#btn-confirm-ok').disabled = true;
        try {
            const res = await fetch('/api/vouchers/redeem', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({ 
                    voucher_id: state.currentVoucher.id, 
                    amount,
                    invoice_number: invoice
                })
            }).then(r => r.json());

            if (res.success) {
                $('#result-amount').textContent = `$${amount.toFixed(2)}`;
                $('#result-invoice').textContent = invoice || 'N/A';
                $('#confirm-modal').classList.add('hidden');
                switchView('result');
            } else {
                alert(res.error);
            }
        } catch (e) { alert('Error de red'); }
        finally { $('#btn-confirm-ok').disabled = false; }
    }

    async function loadCuadre() {
        const historyList = $('#cuadre-history');
        historyList.innerHTML = '<p class="text-center py-20">Cargando...</p>';

        try {
            const res = await fetch('/api/vouchers/redemptions/me', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());

            if (res.success) {
                renderCuadre(res.redemptions);
            }
        } catch (e) { historyList.innerHTML = '<p>Error.</p>'; }
    }

    function renderCuadre(list) {
        const historyList = $('#cuadre-history');
        const total = list.reduce((a, r) => a + r.amount_redeemed, 0);
        
        $('#cuadre-count').textContent = list.length;
        $('#cuadre-total').textContent = `$${total.toFixed(2)}`;

        if (list.length === 0) {
            historyList.innerHTML = '<p class="text-secondary text-center py-20">No hay canjes hoy.</p>';
            return;
        }

        historyList.innerHTML = list.map(r => `
            <div class="card p-10 mb-10 shadow-sm border-radius-sm">
                <div class="row align-between">
                    <strong>$${r.amount_redeemed.toFixed(2)}</strong>
                    <small>${new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                </div>
                <div class="text-xs text-secondary mt-5">
                    ${r.issuing_company_name} ${r.invoice_number ? `• Ticket: ${r.invoice_number}` : ''}
                </div>
            </div>
        `).join('');
    }

    function startScanner() {
        if (state.scanner) return;
        
        const width = $('#scanner-box').clientWidth;
        const qrboxSize = Math.floor(width * 0.7);

        state.scanner = new Html5Qrcode("qr-reader");
        state.scanner.start(
            { facingMode: "environment" },
            { 
                fps: 20, 
                qrbox: { width: qrboxSize, height: qrboxSize },
                aspectRatio: 1.0
            },
            (text) => {
                validateVoucher(text);
                stopScanner();
            }
        ).catch(err => {
            console.error(err);
            state.scanner = null; // Reset state if start fails
            if (err.name === 'NotAllowedError') {
                alert('Permiso de cámara denegado. Por favor, habilite el acceso a la cámara en los ajustes de su navegador.');
            } else {
                alert('Error al iniciar la cámara: ' + err);
            }
        });
    }

    function stopScanner() {
        if (state.scanner) {
            // Check if actually running before calling stop
            if (state.scanner.getState() === 2) { // 2 = SCANNING
                state.scanner.stop().then(() => {
                    state.scanner = null;
                }).catch(e => {
                    console.warn("Error stopping scanner:", e);
                    state.scanner = null;
                });
            } else {
                state.scanner = null;
            }
        }
    }

    init();
})();
