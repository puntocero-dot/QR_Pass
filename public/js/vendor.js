/* ═══════════════════════════════════════════════
   POLLO CAMPERO — Vendor Portal Logic
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── State ────────────────────────────────────
    const state = {
        token: localStorage.getItem('campero_token') || null,
        user: JSON.parse(localStorage.getItem('campero_user') || 'null'),
        vouchers: [],
        clients: [],
        lastBatch: null
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const views = {
        checking: $('#view-checking'),
        dashboard: $('#view-dashboard')
    };

    const header = $('#app-header');

    // ── Init ─────────────────────────────────────
    function init() {
        // Redirection check: must be logged in as vendor
        if (!state.token || !state.user || state.user.role !== 'vendor') {
            console.log('Unauthorized access to vendor portal. Redirecting to login...');
            window.location.href = '/index.html';
            return;
        }

        bindEvents();
        showDashboard();
    }

    function showView(name) {
        Object.values(views).forEach(v => v.classList.remove('active'));
        if (views[name]) {
            views[name].classList.add('active');
            views[name].style.animation = 'none';
            views[name].offsetHeight;
            views[name].style.animation = '';
        }
    }

    function showDashboard() {
        showView('dashboard');
        header.classList.remove('hidden');
        if (state.user) {
            $('#vendor-company-name').textContent = state.user.company_name || 'Vendedor';
        }
        loadVouchers();
        loadClients();
    }

    // ── Events ───────────────────────────────────
    function bindEvents() {
        $('#btn-logout').addEventListener('click', handleLogout);
        $('#create-form').addEventListener('submit', handleCreate);
        $('#btn-close-modal').addEventListener('click', closeModal);
        $('#btn-copy-qr').addEventListener('click', copyQRCode);
        $('#btn-print-batch').addEventListener('click', () => window.print());

        // Close QR modal on overlay click
        $('#qr-modal').addEventListener('click', (e) => {
            if (e.target.id === 'qr-modal') closeModal();
        });

        // Tab switching
        $$('.vendor-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.vendor-tab').forEach(t => t.classList.remove('active'));
                $$('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $(`#tab-${tab.dataset.tab}`).classList.add('active');
            });
        });

        // Client management
        $('#btn-new-client').addEventListener('click', () => openClientModal());
        $('#btn-cancel-client').addEventListener('click', closeClientModal);
        $('#client-form').addEventListener('submit', handleSaveClient);
        $('#client-modal').addEventListener('click', (e) => {
            if (e.target.id === 'client-modal') closeClientModal();
        });

        // Profile / Vendor Name settings
        $('#btn-edit-profile').addEventListener('click', openProfileModal);
        $('#btn-cancel-profile').addEventListener('click', closeProfileModal);
        $('#profile-form').addEventListener('submit', handleSaveProfile);
        $('#profile-modal').addEventListener('click', (e) => {
            if (e.target.id === 'profile-modal') closeProfileModal();
        });
    }

    function openProfileModal() {
        $('#profile-company-name').value = state.user.company_name;
        $('#profile-modal').classList.remove('hidden');
    }

    function closeProfileModal() {
        $('#profile-modal').classList.add('hidden');
    }

    function handleSaveProfile(e) {
        e.preventDefault();
        const newName = $('#profile-company-name').value.trim();
        if (!newName) return;

        state.user.company_name = newName;
        localStorage.setItem('campero_user', JSON.stringify(state.user));
        $('#vendor-company-name').textContent = newName;

        closeProfileModal();
        showToast('Nombre de empresa actualizado', 'success');
    }

    function handleLogout() {
        state.token = null;
        state.user = null;
        localStorage.removeItem('campero_token');
        localStorage.removeItem('campero_user');
        window.location.href = '/index.html';
    }

    // ── Load Vouchers ────────────────────────────
    async function loadVouchers() {
        try {
            const res = await apiCall('/api/vendor/vouchers');
            if (res.success) {
                state.vouchers = res.vouchers;
                renderStats(res.stats);
                renderVoucherTable(res.vouchers);
            }
        } catch (err) {
            if (err.status === 401) { handleLogout(); return; }
            showToast('Error cargando vales', 'error');
        }
    }

    // ── Stats ────────────────────────────────────
    function renderStats(stats) {
        $('#stat-total').textContent = stats.total_vouchers;
        $('#stat-active').textContent = stats.active;
        $('#stat-expired').textContent = stats.expired;
        $('#stat-redeemed').textContent = `$${stats.total_redeemed_value.toFixed(2)}`;
    }

    // ── Voucher Table ────────────────────────────
    function renderVoucherTable(vouchers) {
        if (vouchers.length === 0) {
            $('#empty-state').classList.remove('hidden');
            $('#voucher-table-wrap').classList.add('hidden');
            return;
        }

        $('#empty-state').classList.add('hidden');
        $('#voucher-table-wrap').classList.remove('hidden');

        const tbody = $('#voucher-table-body');
        tbody.innerHTML = '';

        vouchers.forEach((v, i) => {
            const isExpired = v.is_expired;
            const isFullyUsed = v.current_value <= 0;
            let statusText, statusClass;

            if (isExpired) { statusText = 'Vencido'; statusClass = 'status-expired'; }
            else if (isFullyUsed) { statusText = 'Agotado'; statusClass = 'status-used'; }
            else if (v.current_value < v.initial_value) { statusText = `Parcial`; statusClass = 'status-used'; }
            else { statusText = 'Activo'; statusClass = 'status-active'; }

            const clientName = v.client_name || '—';

            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${clientName}</td>
        <td>$${v.initial_value.toFixed(2)}</td>
        <td><strong>$${v.current_value.toFixed(2)}</strong></td>
        <td class="${statusClass}">${statusText}</td>
        <td>${new Date(v.expiry_date).toLocaleDateString('es-SV')}</td>
        <td>${v.use_type === 'Multiple' ? 'Múlt.' : 'Único'}</td>
        <td><button class="btn btn-secondary btn-sm" data-qr="${encodeURIComponent(v.qr_payload)}" data-value="${v.initial_value}" data-expiry="${v.expiry_date}" data-type="${v.use_type}">Ver QR</button></td>
      `;

            tr.querySelector('button').addEventListener('click', function () {
                showQRModal(
                    decodeURIComponent(this.dataset.qr),
                    parseFloat(this.dataset.value),
                    this.dataset.expiry,
                    this.dataset.type
                );
            });

            tbody.appendChild(tr);
        });
    }

    // ── Create Vouchers ──────────────────────────
    async function handleCreate(e) {
        e.preventDefault();

        const value = parseFloat($('#create-value').value);
        const quantity = parseInt($('#create-qty').value);
        const expiry_days = parseInt($('#create-expiry').value);
        const use_type = $('#create-type').value;
        const client_id = $('#create-client').value;

        if (!value || value <= 0) {
            showToast('Ingrese un valor válido', 'error');
            return;
        }

        const btn = $('#btn-create');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-loader"></span> Generando...';

        try {
            const res = await apiCall('/api/vendor/vouchers/create', {
                method: 'POST',
                body: JSON.stringify({
                    value,
                    quantity,
                    expiry_days,
                    use_type,
                    client_id,
                    custom_company_name: state.user.company_name
                })
            });

            if (res.success) {
                state.lastBatch = res;
                showToast(res.message, 'success');
                renderBatchResult(res);
                loadVouchers();
            } else {
                showToast(res.error || 'Error al crear vales', 'error');
            }
        } catch (err) {
            const data = err.data || {};
            showToast(data.error || 'Error de conexión', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        GENERAR VALES CON QR ÚNICOS
      `;
        }
    }

    // ── QR Code Generator Helper ─────────────────
    function generateQRImage(text, cellSize) {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createDataURL(cellSize || 4, 0);
    }

    // ── Batch Result with QR Grid ────────────────
    function renderBatchResult(res) {
        const container = $('#batch-result');
        const grid = $('#batch-qr-grid');

        container.classList.remove('hidden');
        $('#batch-title').textContent = `✅ ${res.vouchers.length} Vale(s) Creado(s)`;
        $('#batch-summary').textContent = `Valor total: $${res.total_value} | Lote: ${res.purchase_id.substring(0, 8)}...`;

        grid.innerHTML = '';

        res.vouchers.forEach((v) => {
            const imgSrc = generateQRImage(v.qr_payload, 3);
            const card = document.createElement('div');
            card.className = 'batch-qr-card';
            card.innerHTML = `
        <img src="${imgSrc}" alt="QR Vale #${v.index}" width="140" height="140">
        <div class="card-label">Vale #${v.index}</div>
        <div class="card-value">$${v.value.toFixed(2)}</div>
      `;

            card.addEventListener('click', () => {
                showQRModal(v.qr_payload, v.value, v.expiry_date, v.use_type);
            });

            grid.appendChild(card);
        });

        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── QR Modal ─────────────────────────────────
    function showQRModal(qrPayload, value, expiry, useType) {
        state._currentQR = qrPayload;

        $('#modal-value').textContent = `$${value.toFixed(2)}`;
        $('#modal-expiry').textContent = new Date(expiry).toLocaleDateString('es-SV', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
        $('#modal-type').textContent = useType === 'Multiple' ? 'Múltiple' : 'Único';
        $('#modal-payload-text').textContent = qrPayload;

        const imgSrc = generateQRImage(qrPayload, 6);
        const display = $('#modal-qr-display');
        display.innerHTML = `<img src="${imgSrc}" alt="Código QR" width="280" height="280">`;

        $('#qr-modal').classList.remove('hidden');
    }

    function closeModal() {
        $('#qr-modal').classList.add('hidden');
    }

    function copyQRCode() {
        if (state._currentQR) {
            navigator.clipboard.writeText(state._currentQR).then(() => {
                showToast('Código QR copiado al portapapeles', 'success');
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = state._currentQR;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
                showToast('Código QR copiado', 'success');
            });
        }
    }

    // ═══════════════════════════════════════════════
    // CLIENT MANAGEMENT
    // ═══════════════════════════════════════════════

    async function loadClients() {
        try {
            const res = await apiCall('/api/clients');
            if (res.success) {
                state.clients = res.clients;
                renderClientsList(res.clients);
                populateClientDropdown(res.clients);
            }
        } catch (err) {
            if (err.status === 401) { handleLogout(); return; }
        }
    }

    function renderClientsList(clients) {
        const container = $('#clients-list');
        const empty = $('#clients-empty');

        if (clients.length === 0) {
            container.innerHTML = '';
            container.appendChild(empty);
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        container.innerHTML = '';

        clients.forEach(c => {
            const card = document.createElement('div');
            card.className = 'client-card';
            card.innerHTML = `
                <h4>${c.name}</h4>
                ${c.trade_name ? `<div class="client-detail">🏷️ ${c.trade_name}</div>` : ''}
                ${c.tax_id ? `<div class="client-detail">📋 NIT: ${c.tax_id}</div>` : ''}
                ${c.email ? `<div class="client-detail">📧 ${c.email}</div>` : ''}
                ${c.phone ? `<div class="client-detail">📞 ${c.phone}</div>` : ''}
                ${c.contact_person ? `<div class="client-detail">👤 ${c.contact_person}</div>` : ''}
                <div class="client-stats">
                    <span>Vales: <strong>${c.voucher_count || 0}</strong></span>
                    <span>Total: <strong>$${(c.total_value || 0).toFixed(2)}</strong></span>
                    <span>Canjeado: <strong>$${(c.redeemed_value || 0).toFixed(2)}</strong></span>
                </div>
            `;

            card.addEventListener('click', () => openClientModal(c));
            container.appendChild(card);
        });
    }

    function populateClientDropdown(clients) {
        const select = $('#create-client');
        // Keep the first "Sin Asignar" option
        select.innerHTML = '<option value="">— Sin Asignar —</option>';
        clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            select.appendChild(opt);
        });
    }

    function openClientModal(client) {
        const modal = $('#client-modal');
        const title = $('#client-modal-title');

        if (client) {
            title.textContent = '✏️ Editar Cliente';
            $('#client-edit-id').value = client.id;
            $('#client-name').value = client.name || '';
            $('#client-trade-name').value = client.trade_name || '';
            $('#client-tax-id').value = client.tax_id || '';
            $('#client-email').value = client.email || '';
            $('#client-phone').value = client.phone || '';
            $('#client-contact').value = client.contact_person || '';
            $('#client-address').value = client.address || '';
            $('#client-notes').value = client.notes || '';
        } else {
            title.textContent = '🏢 Nuevo Cliente';
            $('#client-edit-id').value = '';
            $('#client-form').reset();
        }

        modal.classList.remove('hidden');
    }

    function closeClientModal() {
        $('#client-modal').classList.add('hidden');
    }

    async function handleSaveClient(e) {
        e.preventDefault();

        const editId = $('#client-edit-id').value;
        const data = {
            name: $('#client-name').value.trim(),
            trade_name: $('#client-trade-name').value.trim(),
            tax_id: $('#client-tax-id').value.trim(),
            email: $('#client-email').value.trim(),
            phone: $('#client-phone').value.trim(),
            contact_person: $('#client-contact').value.trim(),
            address: $('#client-address').value.trim(),
            notes: $('#client-notes').value.trim()
        };

        if (!data.name) {
            showToast('El nombre del cliente es requerido', 'error');
            return;
        }

        try {
            let res;
            if (editId) {
                res = await apiCall(`/api/clients/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
            } else {
                res = await apiCall('/api/clients', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
            }

            if (res.success) {
                showToast(res.message, 'success');
                closeClientModal();
                loadClients();
            } else {
                showToast(res.error || 'Error', 'error');
            }
        } catch (err) {
            showToast('Error de conexión', 'error');
        }
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

    // ── Boot ─────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);
})();
