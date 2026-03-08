(function () {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const state = {
        token: localStorage.getItem('restaurantes_token'),
        user: JSON.parse(localStorage.getItem('restaurantes_user') || 'null'),
        currentView: 'overview',
        users: [],
        clients: []
    };

    async function init() {
        if (!state.token || state.user.role !== 'admin') {
            window.location.href = '/index.html';
            return;
        }

        $('#admin-name').textContent = state.user.full_name || state.user.username;
        
        bindEvents();
        loadDashboard();
        loadUsers();
        loadClients();
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

        $$('.btn-close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal').classList.remove('active');
            });
        });

        $('#user-form').addEventListener('submit', handleUserSubmit);
    }

    function switchView(viewId) {
        $$('.view-pane').forEach(p => p.classList.add('hidden'));
        $$('.nav-item').forEach(b => b.classList.remove('active'));
        
        $(`#view-${viewId}`).classList.remove('hidden');
        $(`.nav-item[data-view="${viewId}"]`).classList.add('active');
        state.currentView = viewId;
    }

    async function loadDashboard() {
        // Mock dashboard data for now
        $('#stat-active-companies').textContent = '...';
        $('#stat-total-vouchers').textContent = '...';
    }

    async function loadUsers() {
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

    async function handleUserSubmit(e) {
        e.preventDefault();
        const data = {
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
        $('#user-full-name').value = u.full_name;
        $('#user-username').value = u.username;
        $('#user-role').value = u.role;
        $('#user-related-id').value = u.related_id;
        $('#modal-user').classList.add('active');
    };

    init();
})();
