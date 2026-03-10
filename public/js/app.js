(function () {
    // Version: 1.0.2 - Fixed multi-page TypeError
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);
    const safeAddListener = (sel, event, cb) => {
        const el = $(sel);
        if (el) el.addEventListener(event, cb);
    };

    const state = {
        token: localStorage.getItem('restaurantes_token'),
        user: JSON.parse(localStorage.getItem('restaurantes_user') || 'null'),
        currentVoucher: null,
        scanner: null
    };

    function init() {
        const path = window.location.pathname;
        const isLanding = path === '/' || path === '/index.html';
        const isApp = path.includes('app.html');

        console.log('[App] Init', { path, isLanding, isApp, hasToken: !!state.token });

        if (state.token && state.user) {
            if (state.user.role === 'admin' || state.user.role === 'vendor') {
                location.href = '/admin.html';
                return;
            }
            if (isLanding) {
                location.href = '/app.html';
                return;
            }
            showApp();
        } else {
            // Only force login view if we are on the app page
            if (isApp) {
                switchView('login');
            }
        }
        bindEvents();
    }

    function bindEvents() {
        safeAddListener('#btn-start-login', 'click', () => switchView('login'));
        
        const loginForm = $('#login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
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
        }

        safeAddListener('#btn-logout-header', 'click', handleLogout);

        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view) switchView(view);
            });
        });

        safeAddListener('#btn-manual-validate', 'click', () => {
            const code = $('#manual-code').value;
            if (code) validateVoucher(code);
        });

        safeAddListener('#btn-redeem', 'click', () => {
            const amount = parseFloat($('#redeem-amount').value);
            if (!amount || amount <= 0 || amount > Number(state.currentVoucher.current_value)) {
                alert('Monto inválido');
                return;
            }
            $('#confirm-body').innerHTML = `Vas a canjear <strong>$${Number(amount).toFixed(2)}</strong> del vale de <strong>${state.currentVoucher.issuing_company_name}</strong>.`;
            $('#confirm-modal').classList.remove('hidden');
        });

        safeAddListener('#btn-confirm-cancel', 'click', () => $('#confirm-modal').classList.add('hidden'));
        safeAddListener('#btn-confirm-ok', 'click', handleRedeem);
        safeAddListener('#btn-new-scan', 'click', () => switchView('scanner'));
        safeAddListener('#btn-cancel-voucher', 'click', () => switchView('scanner'));
    }

    function switchView(viewId) {
        const targetView = $(`#view-${viewId}`);
        if (!targetView) {
            console.log('[App] switchView aborted: target not found', viewId);
            return;
        }

        $$('.view').forEach(v => v.classList.remove('active'));
        targetView.classList.add('active');

        // Update nav
        const navEl = $('#bottom-nav');
        if (navEl) {
            $$('.nav-item').forEach(b => b.classList.remove('active'));
            const navBtn = $(`.nav-item[data-view="${viewId}"]`);
            if (navBtn) navBtn.classList.add('active');
        }

        if (viewId === 'scanner') startScanner();
        else stopScanner();

        if (viewId === 'cuadre') loadCuadre();
    }

    function showApp() {
        const header = $('#app-header');
        const nav = $('#bottom-nav');
        if (header) header.classList.remove('hidden');
        if (nav) nav.classList.remove('hidden');
        
        const nameEl = $('#restaurant-name');
        if (nameEl) nameEl.textContent = state.user.restaurant_name || 'Restaurante';
        
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
        const comp = $('#voucher-company');
        const bal = $('#voucher-balance');
        const exp = $('#voucher-expiry');
        const amt = $('#redeem-amount');

        if (comp) comp.textContent = v.issuing_company_name;
        if (bal) bal.textContent = `$${Number(v.current_value).toFixed(2)}`;
        if (exp) exp.textContent = new Date(v.expiry_date).toLocaleDateString();
        if (amt) amt.value = Number(v.current_value).toFixed(2);
        
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
                const resAmt = $('#result-amount');
                const resInv = $('#result-invoice');
                if (resAmt) resAmt.textContent = `$${Number(amount).toFixed(2)}`;
                if (resInv) resInv.textContent = invoice || 'N/A';
                
                const modal = $('#confirm-modal');
                if (modal) modal.classList.add('hidden');
                
                switchView('result');
            } else {
                alert(res.error);
            }
        } catch (e) { alert('Error de red'); }
        finally { $('#btn-confirm-ok').disabled = false; }
    }

    async function loadCuadre() {
        const historyList = $('#cuadre-history');
        if (!historyList) return;
        
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
        if (!historyList) return;

        const total = list.reduce((a, r) => a + Number(r.amount_redeemed), 0);
        
        const countEl = $('#cuadre-count');
        const totalEl = $('#cuadre-total');
        if (countEl) countEl.textContent = list.length;
        if (totalEl) totalEl.textContent = `$${Number(total).toFixed(2)}`;

        if (list.length === 0) {
            historyList.innerHTML = '<p class="text-secondary text-center py-10">No hay canjes hoy.</p>';
            return;
        }

        historyList.innerHTML = list.map(r => `
            <div class="card p-10 mb-10 shadow-sm border-radius-sm" style="background:white; color:black;">
                <div class="row align-between" style="display:flex; justify-content:space-between;">
                    <strong>$${Number(r.amount_redeemed).toFixed(2)}</strong>
                    <small>${new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                </div>
                <div style="font-size:0.75rem; color:#666; margin-top:4px;">
                    ${r.issuing_company_name} ${r.invoice_number ? `• Ticket: ${r.invoice_number}` : ''}
                </div>
            </div>
        `).join('');
    }

    function startScanner() {
        if (state.scanner) return;
        
        const readerEl = $("#qr-reader");
        if (!readerEl) return;
        readerEl.innerHTML = '';

        if (!window.isSecureContext && location.hostname !== 'localhost') {
            readerEl.innerHTML = `<div class="p-20 text-center">⚠️ Cámara requiere HTTPS</div>`;
            return;
        }

        const width = $('#scanner-box') ? $('#scanner-box').clientWidth : 300;
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
            state.scanner = null;
            readerEl.innerHTML = `<div class="p-20 text-center text-xs">Error cámara: ${err}</div>`;
        });
    }

    function stopScanner() {
        if (state.scanner) {
            if (state.scanner.getState() === 2) { 
                state.scanner.stop().then(() => {
                    state.scanner = null;
                }).catch(e => {
                    state.scanner = null;
                });
            } else {
                state.scanner = null;
            }
        }
    }

    init();
})();
