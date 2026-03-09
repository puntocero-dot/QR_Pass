(function () {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const state = {
        token: localStorage.getItem('restaurantes_token'),
        user: JSON.parse(localStorage.getItem('restaurantes_user') || 'null'),
        currentView: 'overview',
        users: [],
        clients: [],
        vouchers: []
    };

    async function init() {
        if (!state.token || (state.user.role !== 'admin' && state.user.role !== 'vendor')) {
            window.location.href = '/index.html';
            return;
        }

        const nameEl = $('#admin-name');
        if (nameEl) nameEl.textContent = state.user.full_name || state.user.username;
        
        // Role based UI
        if (state.user.role === 'vendor') {
            const usersTab = $(`.nav-item[data-view="users"]`);
            if (usersTab) usersTab.style.display = 'none';
        }

        bindEvents();
        loadDashboard();
        loadUsers();
        loadClients();
        loadVouchers();
    }


    function bindEvents() {
        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (!view) return;
                switchView(view);
            });
        });

        $('#btn-logout').addEventListener('click', () => {
            localStorage.removeItem('restaurantes_token');
            localStorage.removeItem('restaurantes_user');
            window.location.href = '/index.html';
        });

        $('#btn-add-user').addEventListener('click', () => {
            $('#modal-user-title').textContent = 'Nuevo Usuario';
            $('#user-form').reset();
            $('#modal-user').classList.add('active');
        });

        $('#btn-add-client').addEventListener('click', () => {
            $('#modal-client-title').textContent = 'Nueva Empresa';
            $('#client-form').reset();
            $('#client-id').value = '';
            $('#modal-client').classList.add('active');
        });

        $('#btn-open-bulk').addEventListener('click', () => {
            const select = $('#bulk-client');
            select.innerHTML = '<option value="">— Seleccionar —</option>' + 
                state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            $('#modal-bulk').classList.add('active');
        });

        $$('.btn-close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal').classList.remove('active');
            });
        });

        $('#user-form').addEventListener('submit', handleUserSubmit);
        $('#client-form').addEventListener('submit', handleClientSubmit);
        $('#create-voucher-form').addEventListener('submit', handleVoucherCreate);
        $('#bulk-form').addEventListener('submit', handleBulkSubmit);
    }

    function switchView(viewId) {
        $$('.view-pane').forEach(p => p.classList.add('hidden'));
        $$('.nav-item').forEach(b => b.classList.remove('active'));
        
        $(`#view-${viewId}`).classList.remove('hidden');
        $(`.nav-item[data-view="${viewId}"]`).classList.add('active');
        state.currentView = viewId;
    }

    async function loadDashboard() {
        try {
            const res = await fetch('/api/admin/stats', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());
            
            if (res.success) {
                $('#stat-active-companies').textContent = res.stats.activeClients || res.stats.total_clients || '0';
                $('#stat-total-vouchers').textContent = res.stats.total_vouchers;
                $('#stat-active-vouchers').textContent = res.stats.active_vouchers;
                $('#stat-total-value').textContent = `$${Number(res.stats.total_value).toFixed(2)}`;
                $('#stat-redeemed-value').textContent = `$${Number(res.stats.redeemed_value).toFixed(2)}`;
                const redeemedEl = $('#stat-total-redeemed');
                if (redeemedEl) redeemedEl.textContent = res.stats.totalRedeemed || res.stats.total_redemptions || '0';
            }
        } catch (e) { console.error('Stats error', e); }
    }

    async function loadVouchers() {
        try {
            const endpoint = state.user.role === 'admin' ? '/api/admin/vouchers' : '/api/vendor/vouchers';
            const res = await fetch(endpoint, {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());
            
            if (res.success) {
                state.vouchers = res.vouchers;
                renderVouchers();
            }
        } catch (e) { console.error('Load vouchers error', e); }
    }

    async function loadUsers() {
        if (state.user.role !== 'admin') return;
        try {
            const res = await fetch('/api/admin/users', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());
            
            if (res.success) {
                state.users = res.users;
                renderUsers();
            }
        } catch (e) { console.error('Load users error', e); }
    }

    function renderUsers() {
        const tbody = $('#users-table-body');
        if (!tbody) return;
        tbody.innerHTML = state.users.map(u => `
            <tr>
                <td><strong>${u.username}</strong></td>
                <td>${u.full_name}</td>
                <td><span class="badge badge-${u.role}">${u.role}</span></td>
                <td><small>${u.related_id || '-'}</small></td>
                <td>
                    <button class="btn btn-ghost btn-xs" onclick="editUser('${u.id}')">✏️</button>
                    <button class="btn btn-ghost btn-xs" onclick="deleteUser('${u.id}')">🗑️</button>
                </td>
            </tr>
        `).join('');
    }

    function renderVouchers() {
        const tbody = $('#vouchers-table-body');
        if (!tbody) return;
        tbody.innerHTML = state.vouchers.map((v, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${v.client_name || '—'}</td>
                <td>$${Number(v.initial_value).toFixed(2)}</td>
                <td><strong>$${Number(v.current_value).toFixed(2)}</strong></td>
                <td><span class="badge ${Number(v.current_value) <= 0 ? 'badge-cashier' : 'badge-admin'}">${Number(v.current_value) <= 0 ? 'AGOTADO' : 'ACTIVO'}</span></td>
                <td>${new Date(v.expiry_date).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-ghost btn-xs" onclick="showQR('${v.id}')">QR</button>
                </td>
            </tr>
        `).join('');
    }

    async function loadClients() {
        try {
            const res = await fetch('/api/clients', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());
            
            if (res.success) {
                state.clients = res.clients;
                renderClients();
                populateVoucherClients();
            }
        } catch (e) { console.error('Load clients error', e); }
    }

    function renderClients() {
        const grid = $('#clients-grid');
        if (!grid) return;
        grid.innerHTML = state.clients.map(c => `
            <div class="card p-24">
                <h3 class="mb-4">${c.name}</h3>
                <p class="text-xs text-secondary mb-12">NIT: ${c.tax_id || '—'}</p>
                <div class="flex justify-between text-xs mb-16">
                    <span>Vales: <strong>${c.voucher_count || 0}</strong></span>
                    <span>Consumido: <strong>$${(c.redeemed_value || 0).toFixed(2)}</strong></span>
                </div>
                <div class="flex gap-8">
                    <button class="btn btn-secondary btn-sm flex-1" onclick="editClient('${c.id}')">Editar</button>
                    <button class="btn btn-ghost btn-sm" onclick="copyPortalLink('${c.access_token}')">Link</button>
                </div>
            </div>
        `).join('');
    }

    function populateVoucherClients() {
        const select = $('#create-voucher-client');
        if (select) {
            select.innerHTML = '<option value="">— Seleccionar —</option>' + 
                state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
    }

    async function handleClientSubmit(e) {
        e.preventDefault();
        const id = $('#client-id').value;
        const data = {
            name: $('#client-name').value,
            tax_id: $('#client-tax-id').value,
            email: $('#client-email').value,
            contact_person: $('#client-contact').value
        };

        try {
            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/clients/${id}` : '/api/clients';
            const res = await fetch(url, {
                method,
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify(data)
            }).then(r => r.json());

            if (res.success) {
                $('#modal-client').classList.remove('active');
                loadClients();
            } else { alert(res.error); }
        } catch (e) { alert('Error guardando cliente'); }
    }

    async function handleVoucherCreate(e) {
        e.preventDefault();
        const data = {
            client_id: $('#create-voucher-client').value,
            value: parseFloat($('#create-voucher-value').value),
            quantity: parseInt($('#create-voucher-qty').value),
            use_type: $('#create-voucher-type').value
        };

        try {
            const res = await fetch('/api/vendor/vouchers/create', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify(data)
            }).then(r => r.json());

            if (res.success) {
                renderBatchResult(res);
                loadVouchers();
                $('#create-voucher-form').reset();
            } else { alert(res.error); }
        } catch (e) { alert('Error creando vales'); }
    }

    function renderBatchResult(res) {
        const container = $('#batch-result');
        const grid = $('#batch-qr-grid');
        container.classList.remove('hidden');
        $('#batch-title').textContent = `✅ ${res.vouchers.length} Vales Creados`;
        
        grid.innerHTML = res.vouchers.map(v => {
            const qr = qrcode(0, 'M');
            qr.addData(v.qr_payload);
            qr.make();
            const img = qr.createDataURL(3);
            return `
                <div class="text-center p-8 border rounded">
                    <img src="${img}" class="mx-auto mb-4" width="100">
                    <div class="text-xs font-bold">$${v.value.toFixed(2)}</div>
                </div>
            `;
        }).join('');
        container.scrollIntoView({ behavior: 'smooth' });
    }

    async function handleBulkSubmit(e) {
        e.preventDefault();
        const file = $('#bulk-file').files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function() {
            const lines = reader.result.split('\n').filter(l => l.trim());
            const recipients = lines.slice(1).map(l => {
                const parts = l.split(',');
                return { name: parts[0]?.trim(), contact: parts[1]?.trim() };
            }).filter(r => r.name);

            const data = {
                client_id: $('#bulk-client').value,
                value: parseFloat($('#bulk-value').value),
                recipients
            };

            try {
                const res = await fetch('/api/vendor/vouchers/bulk', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}`
                    },
                    body: JSON.stringify(data)
                }).then(r => r.json());

                if (res.success) {
                    $('#modal-bulk').classList.remove('active');
                    renderBatchResult(res);
                    loadVouchers();
                } else { alert(res.error); }
            } catch (e) { alert('Error en carga masiva'); }
        };
        reader.readAsText(file);
    }

    window.showQR = (id) => {
        const v = state.vouchers.find(v => v.id === id);
        if (!v) return;
        const qr = qrcode(0, 'M');
        qr.addData(v.qr_payload);
        qr.make();
        $('#qr-display').innerHTML = qr.createImgTag(5);
        $('#qr-payload-text').textContent = v.qr_payload;
        $('#modal-qr').classList.add('active');
    };

    window.editClient = (id) => {
        const c = state.clients.find(c => c.id === id);
        if (!c) return;
        $('#modal-client-title').textContent = 'Editar Empresa';
        $('#client-id').value = c.id;
        $('#client-name').value = c.name;
        $('#client-tax-id').value = c.tax_id || '';
        $('#client-email').value = c.email || '';
        $('#client-contact').value = c.contact_person || '';
        $('#modal-client').classList.add('active');
    };

    window.copyPortalLink = (token) => {
        const url = `${window.location.origin}/client.html?token=${token}`;
        navigator.clipboard.writeText(url);
        alert('Link del portal copiado');
    };

    async function handleUserSubmit(e) {
        e.preventDefault();
        const id = $('#user-id').value;
        const data = {
            id: id || null,
            full_name: $('#user-full-name').value,
            username: $('#user-username').value,
            password: $('#user-password').value,
            role: $('#user-role').value,
            related_id: $('#user-related-id').value
        };

        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify(data)
            }).then(r => r.json());

            if (res.success) {
                $('#modal-user').classList.remove('active');
                loadUsers();
            } else {
                alert(res.error || 'Error al guardar');
            }
        } catch (e) { alert('Error de conexión'); }
    }

    window.editUser = (id) => {
        const u = state.users.find(u => u.id === id);
        if (!u) return;
        $('#modal-user-title').textContent = 'Editar Usuario';
        $('#user-id').value = u.id;
        $('#user-full-name').value = u.full_name;
        $('#user-username').value = u.username;
        $('#user-role').value = u.role;
        $('#user-related-id').value = u.related_id;
        $('#user-password').value = '********'; // Placeholder to indicate no change unless edited
        $('#modal-user').classList.add('active');
    };

    window.deleteUser = async (id) => {
        if (!confirm('¿Está seguro de eliminar este usuario?')) return;
        try {
            const res = await fetch(`/api/admin/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${state.token}` }
            }).then(r => r.json());
            if (res.success) loadUsers();
            else alert(res.error);
        } catch (e) { alert('Error eliminando usuario'); }
    };

    init();
})();
