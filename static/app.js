document.addEventListener('DOMContentLoaded', () => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const loginScreen = $('#login-screen');
  const appScreen = $('#app-screen');
  const loginForm = $('#login-form');
  const loginError = $('#login-error');
  const logoutBtn = $('#logout-btn');
  const userNameDisplay = $('#sidebar-user-name');
  const tabButtons = $$('.tab-btn');
  const tabContents = $$('.tab-content');
  const expenseForm = $('#expense-form');
  const userRegisterForm = $('#user-register-form');
  const payerSelect = $('#payer-select');
  const globalBalanceTop = $('#global-balance-top');
  const groupTotalDisplay = $('#group-total-display');
  const detailBalancesList = $('#detail-balances-list');
  const detailExpensesTbody = $('#detail-expenses-tbody');
  const settlementsList = $('#settlements-list');
  const paymentOptionsList = $('#payment-options-list');
  let usersDataMap = {};
  let currentUser = null;

  const money = (value) => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(value) || 0);
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const initials = (name) => String(name || 'CC').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const categoryIcon = (category) => ({ Comida: '☕', Transporte: '↗', Alojamiento: '⌂', General: '▤' }[category] || '▤');

  function showTab(tabId) {
    tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === tabId));
    tabContents.forEach(section => section.classList.toggle('active', section.id === tabId));
    const active = tabButtons.find(button => button.dataset.tab === tabId);
    const titleMap = {
      'tab-groups': 'Resumen general', 'tab-detail': 'Detalle del grupo',
      'tab-expense': 'Registrar gasto', 'tab-user': 'Agregar integrante', 'tab-settle': 'Liquidar deudas'
    };
    $('#page-title').textContent = titleMap[tabId] || active?.textContent.trim() || 'Cuentas Claras';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  tabButtons.forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));
  $$('[data-open-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.openTab)));
  $('#quick-add-expense').addEventListener('click', () => showTab('tab-expense'));

  async function request(url, options = {}) {
    const response = await fetch(url, options);
    let data = {};
    try { data = await response.json(); } catch (_) { /* response may be empty */ }
    if (!response.ok) throw new Error(data.detail || data.message || 'No se pudo completar la solicitud.');
    return data;
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.innerHTML = 'Verificando…';
    try {
      const data = await request('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: $('#login-email').value.trim(),
          password: $('#login-password').value
        })
      });
      currentUser = data.user;
      // Store only the display identity; credentials are never saved in localStorage.
      localStorage.setItem('splitwise_user', JSON.stringify({ id: data.user.id, name: data.user.name, email: data.user.email }));
      activateApp(currentUser);
    } catch (error) {
      loginError.textContent = error.message || 'No fue posible iniciar sesión. Revisa tu conexión.';
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Iniciar sesión <span>→</span>';
    }
  });

  const savedUser = localStorage.getItem('splitwise_user');
  if (savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && parsed.name && parsed.email) {
        // Refresh identity from the server-backed user list after loading the dashboard.
        currentUser = parsed;
        activateApp(parsed);
      }
    } catch (_) { localStorage.removeItem('splitwise_user'); }
  }

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('splitwise_user');
    currentUser = null;
    appScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginForm.reset();
    loginError.textContent = '';
  });

  function activateApp(user) {
    currentUser = user;
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    const name = user.name || 'Usuario';
    userNameDisplay.textContent = name;
    $('#welcome-name').textContent = name.split(' ')[0];
    $('#sidebar-avatar').textContent = initials(name);
    $('#top-avatar').textContent = initials(name);
    loadDashboard();
  }

  userRegisterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = userRegisterForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await request('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('#reg-name').value.trim(), email: $('#reg-email').value.trim(),
          password: $('#reg-password').value,
          bank_account: $('#reg-bank-acc').value.trim() || 'Sin cuenta',
          bank_name: $('#reg-bank-name').value.trim() || 'SPEI'
        })
      });
      userRegisterForm.reset();
      await loadDashboard();
      alert('Integrante registrado correctamente.');
      showTab('tab-detail');
    } catch (error) { alert(error.message); }
    finally { submit.disabled = false; }
  });

  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = expenseForm.querySelector('button[type="submit"]');
    const amount = Number($('#amount').value);
    if (!Number.isFinite(amount) || amount <= 0) { alert('Ingresa un monto mayor que cero.'); return; }
    submit.disabled = true;
    try {
      await request('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer: payerSelect.value, description: $('#description').value.trim(),
          amount, category: $('#category').value
        })
      });
      expenseForm.reset();
      await loadDashboard();
      showTab('tab-detail');
    } catch (error) { alert(error.message); }
    finally { submit.disabled = false; }
  });

  async function loadDashboard() {
    try {
      const data = await request('/api/dashboard');
      const total = Number(data.total_acumulado) || 0;
      groupTotalDisplay.textContent = money(total);
      $('#group-total-mini').textContent = money(total);
      $('#member-count').textContent = data.users.length;
      $('#group-member-caption').textContent = `${data.users.length} integrante${data.users.length === 1 ? '' : 's'}`;
      usersDataMap = Object.fromEntries((data.users_data || []).map(user => [user.name, user]));
      const netBalances = data.net_balances || {};
      const currentName = currentUser?.name;
      const personalBalance = Number(netBalances[currentName] ?? 0);
      globalBalanceTop.textContent = `${personalBalance >= 0 ? '+' : '−'}${money(Math.abs(personalBalance))}`;
      globalBalanceTop.classList.toggle('negative', personalBalance < 0);
      globalBalanceTop.classList.toggle('positive', personalBalance >= 0);

      payerSelect.innerHTML = (data.users || []).map(name => `<option value="${safe(name)}" ${name === currentName ? 'selected' : ''}>${safe(name)}</option>`).join('');

      const expenses = data.expenses || [];
      detailExpensesTbody.innerHTML = expenses.length ? expenses.map(expense => `
        <tr><td><b>${safe(expense.description)}</b><div class="table-category">${safe(expense.category || 'General')}</div></td>
        <td>${safe(expense.payer)}</td><td><strong>${money(expense.amount)}</strong></td></tr>`).join('')
        : '<tr><td colspan="3" class="text-center">Todavía no hay gastos registrados.</td></tr>';

      const people = Object.entries(netBalances);
      detailBalancesList.innerHTML = people.length ? people.map(([name, balance]) => balanceRow(name, Number(balance))).join('')
        : '<p class="empty-text">No hay balances para mostrar.</p>';
      $('#overview-balances').innerHTML = people.length ? people.map(([name, balance]) => {
        const value = Number(balance);
        return `<div class="overview-person"><div class="person-head"><span class="person-initial">${safe(initials(name))}</span><b>${safe(name)}</b></div><small>${value > 0.01 ? 'Tiene a favor' : value < -0.01 ? 'Tiene pendiente' : 'Balance al día'}</small><strong class="${value > 0.01 ? 'positive' : value < -0.01 ? 'negative' : ''}">${value > 0.01 ? '+' : value < -0.01 ? '−' : ''}${money(Math.abs(value))}</strong></div>`;
      }).join('') : '<p class="empty-text">No hay balances para mostrar.</p>';

      const recent = $('#recent-expenses-list');
      recent.innerHTML = expenses.length ? expenses.slice(0, 4).map(expense => `
        <div class="recent-item"><div class="expense-icon">${categoryIcon(expense.category)}</div><div class="expense-copy"><b>${safe(expense.description)}</b><small>${safe(expense.payer)} · ${safe(expense.category || 'General')}</small></div><div class="expense-amount">${money(expense.amount)}<small>Registrado</small></div></div>`).join('')
        : '<div class="empty-state"><span>◷</span><b>Aún no hay movimientos</b><small>Cuando registres un gasto aparecerá aquí.</small></div>';

      const settlements = data.settlements || [];
      if (!settlements.length) {
        settlementsList.innerHTML = '<div class="empty-state"><span>✓</span><b>¡Todo está en orden!</b><small>No hay transferencias pendientes.</small></div>';
        paymentOptionsList.innerHTML = '<p class="empty-text">No hay pagos pendientes por ahora.</p>';
      } else {
        settlementsList.innerHTML = settlements.map(item => `
          <div class="settlement-item"><span><b>${safe(item.from_user)}</b><br><small style="color:#96a1af">debe pagar a</small><br><b>${safe(item.to_user)}</b></span><span class="negative balance-status">${money(item.amount)}</span></div>`).join('');
        paymentOptionsList.innerHTML = settlements.map(item => {
          const creditor = usersDataMap[item.to_user] || { bank_account: 'Sin cuenta registrada', bank_name: 'Banco no indicado' };
          return `<div class="payment-box"><div>${safe(item.from_user)} <span style="color:#9aa4b2;font-weight:500">paga a</span> ${safe(item.to_user)}</div><div class="bank-text">${safe(creditor.bank_name)} · Cuenta: <code>${safe(creditor.bank_account || 'Sin cuenta registrada')}</code></div><div class="payment-action"><strong>${money(item.amount)}</strong><button class="btn-pay" data-pay-from="${safe(item.from_user)}" data-pay-to="${safe(item.to_user)}" data-pay-amount="${Number(item.amount)}">Registrar pago →</button></div></div>`;
        }).join('');
      }
    } catch (error) {
      console.error('No se pudo cargar el panel:', error);
      if (!appScreen.classList.contains('hidden')) alert(`No se pudo actualizar el panel: ${error.message}`);
    }
  }

  function balanceRow(name, balance) {
    const status = balance > 0.01 ? 'A favor' : balance < -0.01 ? 'Debe' : 'Al día';
    const className = balance > 0.01 ? 'positive' : balance < -0.01 ? 'negative' : '';
    return `<div class="user-balance-row"><span><span class="person-initial">${safe(initials(name))}</span><span class="balance-name">${safe(name)}</span></span><span class="balance-status ${className}">${status} · ${money(Math.abs(balance))}</span></div>`;
  }

  paymentOptionsList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-pay-from]');
    if (!button) return;
    const from_user = button.dataset.payFrom;
    const to_user = button.dataset.payTo;
    const amount = Number(button.dataset.payAmount);
    if (!confirm(`¿Confirmas que ${from_user} ya pagó ${money(amount)} a ${to_user}? Esta acción registra el pago en la aplicación, no mueve dinero del banco.`)) return;
    button.disabled = true;
    try {
      await request('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_user, to_user, amount, method: 'SPEI' })
      });
      await loadDashboard();
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  });
});
