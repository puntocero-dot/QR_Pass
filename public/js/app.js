/* ═══════════════════════════════════════════════
   POLLO CAMPERO — Voucher PWA App Logic
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── State ────────────────────────────────────
    const state = {
        token: localStorage.getItem('campero_token') || null,
        user: JSON.parse(localStorage.getItem('campero_user') || 'null'),
        currentVoucher: null,
        scanner: null,
        scanning: false
    };

    // ── DOM References ───────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const views = {
        login: $('#view-login'),
        scanner: $('#view-scanner'),
        voucher: $('#view-voucher'),
        result: $('#view-result'),
        error: $('#view-error')
    };

    const header = $('#app-header');

    // ── Init ─────────────────────────────────────
    function init() {
        bindEvents();

        if (state.token && state.user) {
            showView('scanner');
            showHeader();
            updateRestaurantName();
            initScanner();
        } else {
            showView('login');
        }
    }

    // ── View Management ──────────────────────────
    function showView(name) {
        Object.values(views).forEach(v => v.classList.remove('active'));
        views[name].classList.add('active');

        // Re-trigger animation
        views[name].style.animation = 'none';
        views[name].offsetHeight; // reflow
        views[name].style.animation = '';

        // Stop scanner when leaving scanner view
        if (name !== 'scanner' && state.scanner) {
            try {
                state.scanner.stop().catch(() => { });
            } catch (e) { }
            state.scanning = false;
        }
    }

    function showHeader() {
        header.classList.remove('hidden');
    }

    function hideHeader() {
        header.classList.add('hidden');
    }

    function updateRestaurantName() {
        if (state.user) {
            $('#restaurant-name').textContent = state.user.restaurant_name || state.user.restaurant_id;
        }
    }

    // ── Event Binding ────────────────────────────
    function bindEvents() {
        // Login form
        $('#login-form').addEventListener('submit', handleLogin);

        // Logout
        $('#btn-logout').addEventListener('click', handleLogout);

        // Manual code validation
        $('#btn-manual-validate').addEventListener('click', () => {
            const code = $('#manual-code').value.trim();
            if (code) validateVoucher(code);
        });

        $('#manual-code').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = $('#manual-code').value.trim();
                if (code) validateVoucher(code);
            }
        });

        // Redeem button
        $('#btn-redeem').addEventListener('click', handleRedeem);

        // Consult only — back to scanner
        $('#btn-consult-only').addEventListener('click', () => {
            showView('scanner');
            initScanner();
        });

        // New scan after result
        $('#btn-new-scan').addEventListener('click', () => {
            showView('scanner');
            initScanner();
        });

        // Retry after error
        $('#btn-error-retry').addEventListener('click', () => {
            showView('scanner');
            initScanner();
        });
    }

    // ── Login ────────────────────────────────────
    async function handleLogin(e) {
        e.preventDefault();

        const username = $('#login-user').value.trim();
        const password = $('#login-pass').value;
        const errorEl = $('#login-error');
        const btnText = $('#btn-login .btn-text');
        const btnLoader = $('#btn-login .btn-loader');

        errorEl.classList.add('hidden');
        btnText.textContent = 'Autenticando...';
        btnLoader.classList.remove('hidden');
        $('#btn-login').disabled = true;

        try {
            const res = await apiCall('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });

            if (res.success) {
                state.token = res.token;
                state.user = res.user;
                localStorage.setItem('campero_token', res.token);
                localStorage.setItem('campero_user', JSON.stringify(res.user));

                showHeader();
                updateRestaurantName();
                showView('scanner');
                initScanner();
                showToast('Sesión iniciada correctamente', 'success');
            } else {
                errorEl.textContent = res.error || 'Error de autenticación';
                errorEl.classList.remove('hidden');
            }
        } catch (err) {
            errorEl.textContent = 'Error de conexión — Intente de nuevo';
            errorEl.classList.remove('hidden');
        } finally {
            btnText.textContent = 'Iniciar Sesión';
            btnLoader.classList.add('hidden');
            $('#btn-login').disabled = false;
        }
    }

    function handleLogout() {
        state.token = null;
        state.user = null;
        state.currentVoucher = null;
        localStorage.removeItem('campero_token');
        localStorage.removeItem('campero_user');

        if (state.scanner) {
            try { state.scanner.stop().catch(() => { }); } catch (e) { }
            state.scanner = null;
        }

        hideHeader();
        showView('login');
        showToast('Sesión cerrada', 'info');
    }

    // ── QR Scanner ───────────────────────────────
    function initScanner() {
        const readerId = 'qr-reader';

        // Clean up previous scanner
        if (state.scanner) {
            try {
                state.scanner.stop().catch(() => { });
            } catch (e) { }
            state.scanner = null;
        }

        // Clear the reader div
        const readerEl = document.getElementById(readerId);
        if (readerEl) {
            readerEl.innerHTML = '';
        }

        try {
            state.scanner = new Html5Qrcode(readerId);

            state.scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 220, height: 220 },
                    aspectRatio: 1.0
                },
                onQRCodeScanned,
                () => { } // Ignore scan errors silently
            ).then(() => {
                state.scanning = true;
                updateScannerStatus('Cámara activa — Escanee un QR', true);
            }).catch((err) => {
                console.warn('Camera not available:', err);
                updateScannerStatus('Cámara no disponible — Use entrada manual', false);
            });
        } catch (err) {
            console.warn('Scanner init error:', err);
            updateScannerStatus('Error de escáner — Use entrada manual', false);
        }
    }

    function onQRCodeScanned(decodedText) {
        // Stop scanning to prevent further reads
        if (state.scanner) {
            try { state.scanner.stop().catch(() => { }); } catch (e) { }
            state.scanning = false;
        }

        showToast('QR detectado — Validando...', 'info');
        validateVoucher(decodedText);
    }

    function updateScannerStatus(text, active) {
        const statusEl = $('#scanner-status');
        statusEl.innerHTML = `
      <span class="status-dot ${active ? 'pulse' : ''}" style="background: ${active ? 'var(--success)' : 'var(--warning)'}"></span>
      <span style="color: ${active ? 'var(--success)' : 'var(--warning)'}">${text}</span>
    `;
    }

    // ── Voucher Validation ───────────────────────
    async function validateVoucher(code) {
        try {
            const res = await apiCall(`/api/vouchers/validate/${encodeURIComponent(code)}`);

            if (res.success) {
                state.currentVoucher = res.voucher;
                state.currentVoucher._qrCode = code;
                renderVoucherDetail(res.voucher);
                showView('voucher');
            } else {
                showError(res.error, res.code, res.step);
            }
        } catch (err) {
            if (err.status === 401) {
                showToast('Sesión expirada — Inicie sesión de nuevo', 'error');
                handleLogout();
                return;
            }

            const data = err.data || {};
            showError(
                data.error || 'Error al validar el vale',
                data.code || 'UNKNOWN',
                data.step || ''
            );
        }
    }

    // ── Render Voucher Detail ────────────────────
    function renderVoucherDetail(v) {
        // Company & tag
        $('#voucher-company').textContent = v.issuing_company_name || '—';
        $('#voucher-tag').textContent = v.use_type === 'Single' ? 'VALE ÚNICO' : 'VALE MÚLTIPLE';

        // Balance
        const balanceStr = `$${v.current_value.toFixed(2)}`;
        $('#voucher-balance').textContent = balanceStr;

        // Low balance warning
        const statBalance = document.querySelector('.stat-balance');
        if (v.current_value < v.initial_value * 0.2) {
            statBalance.classList.add('low-balance');
        } else {
            statBalance.classList.remove('low-balance');
        }

        // Expiry
        const expiryDate = new Date(v.expiry_date);
        $('#voucher-expiry').textContent = expiryDate.toLocaleDateString('es-SV', {
            day: '2-digit', month: 'short', year: 'numeric'
        });

        // Progress bar
        const usedAmount = v.initial_value - v.current_value;
        const usedPct = (usedAmount / v.initial_value) * 100;
        $('#voucher-progress-fill').style.width = `${usedPct}%`;
        $('#voucher-used').textContent = `Usado: $${usedAmount.toFixed(2)}`;
        $('#voucher-initial').textContent = `Total: $${v.initial_value.toFixed(2)}`;

        // Badges
        setBadge('badge-balance', v.current_value > 0, 'Saldo OK', 'Sin Saldo');
        setBadge('badge-expiry', expiryDate > new Date(), 'Fecha Vigente', 'Vencido');
        setBadge('badge-signature', true, 'Firma Válida', 'Firma Inválida');

        // Set max amount
        $('#redeem-amount').max = v.current_value;
        $('#redeem-amount').value = '';
    }

    function setBadge(id, ok, okText, errorText) {
        const el = document.getElementById(id);
        const checkSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        const xSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        el.className = ok ? 'badge badge-ok' : 'badge badge-error';
        el.innerHTML = (ok ? checkSvg : xSvg) + ' ' + (ok ? okText : errorText);
    }

    // ── Redeem ───────────────────────────────────
    async function handleRedeem() {
        const v = state.currentVoucher;
        if (!v) return;

        const amountInput = $('#redeem-amount');
        const amount = parseFloat(amountInput.value);

        if (!amount || amount <= 0) {
            showToast('Ingrese un monto válido', 'error');
            amountInput.focus();
            return;
        }

        if (amount > v.current_value) {
            showToast(`Monto excede el saldo ($${v.current_value.toFixed(2)})`, 'error');
            amountInput.focus();
            return;
        }

        // Show custom confirm modal
        const confirmed = await showConfirmModal(v, amount);
        if (!confirmed) return;

        // Generate unique nonce for idempotency
        const nonce = generateNonce();

        const btn = $('#btn-redeem');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-loader"></span> Procesando...';

        try {
            const res = await apiCall('/api/vouchers/redeem', {
                method: 'POST',
                body: JSON.stringify({
                    voucher_id: v.id,
                    amount: amount,
                    nonce: nonce
                })
            });

            if (res.success) {
                showResult(res);
            } else {
                showToast(res.error || 'Error al canjear', 'error');
            }
        } catch (err) {
            if (err.status === 401) {
                showToast('Sesión expirada', 'error');
                handleLogout();
                return;
            }
            const data = err.data || {};
            showToast(data.error || 'Error de conexión', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <span>CANJEAR</span>
      `;
        }
    }

    // ── Confirm Modal ────────────────────────────
    function showConfirmModal(voucher, amount) {
        return new Promise((resolve) => {
            const newBalance = (voucher.current_value - amount).toFixed(2);
            const body = $('#confirm-body');
            body.innerHTML = `
        <div class="confirm-line"><span>Empresa</span> <strong>${voucher.issuing_company_name}</strong></div>
        <div class="confirm-line"><span>Saldo Actual</span> <strong>$${voucher.current_value.toFixed(2)}</strong></div>
        <div class="confirm-line"><span>Monto a Canjear</span> <strong style="color: var(--red-400);">-$${amount.toFixed(2)}</strong></div>
        <div class="confirm-divider"></div>
        <div class="confirm-line confirm-total"><span>Saldo Después</span> <strong>$${newBalance}</strong></div>
      `;

            const modal = $('#confirm-modal');
            const btnOk = $('#btn-confirm-ok');
            const btnCancel = $('#btn-confirm-cancel');

            modal.classList.remove('hidden');

            function cleanup() {
                modal.classList.add('hidden');
                btnOk.removeEventListener('click', onConfirm);
                btnCancel.removeEventListener('click', onCancel);
            }

            function onConfirm() { cleanup(); resolve(true); }
            function onCancel() { cleanup(); resolve(false); }

            btnOk.addEventListener('click', onConfirm);
            btnCancel.addEventListener('click', onCancel);
        });
    }

    // ── Result View ──────────────────────────────
    function showResult(res) {
        const r = res.redemption;

        $('#result-icon').className = 'result-icon result-success';
        $('#result-icon').innerHTML = '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        $('#result-title').textContent = '¡Canje Exitoso!';
        $('#result-message').textContent = res.message;

        $('#result-amount').textContent = `$${r.amount_redeemed.toFixed(2)}`;
        $('#result-new-balance').textContent = `$${r.new_balance.toFixed(2)}`;
        $('#result-restaurant').textContent = r.restaurant_id;
        $('#result-cashier').textContent = r.cashier_id;
        $('#result-timestamp').textContent = new Date(r.timestamp).toLocaleString('es-SV');

        $('#result-details').classList.remove('hidden');

        showView('result');
    }

    function showError(message, code, step) {
        $('#error-title').textContent = getErrorTitle(code);
        $('#error-message').textContent = message;
        $('#error-step').textContent = step ? `Paso: ${step}` : '';
        $('#error-step').style.display = step ? 'block' : 'none';

        showView('error');
    }

    function getErrorTitle(code) {
        const titles = {
            'INVALID_SIGNATURE': '🔒 Firma Inválida',
            'VOUCHER_NOT_FOUND': '🔍 Vale No Encontrado',
            'VOUCHER_EXPIRED': '📅 Vale Vencido',
            'VOUCHER_INACTIVE': '🚫 Vale Desactivado',
            'NO_BALANCE': '💰 Sin Saldo',
            'INSUFFICIENT_BALANCE': '💰 Saldo Insuficiente'
        };
        return titles[code] || '❌ Error de Validación';
    }

    // ── API Helper ───────────────────────────────
    async function apiCall(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
        };

        const res = await fetch(url, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) }
        });

        const data = await res.json();

        if (!res.ok) {
            const err = new Error(data.error || 'API Error');
            err.status = res.status;
            err.data = data;
            throw err;
        }

        return data;
    }

    // ── Toast ────────────────────────────────────
    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ── Helpers ──────────────────────────────────
    function generateNonce() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
    }

    // ── Boot ─────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);
})();
