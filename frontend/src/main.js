import './style.css';

const list = document.getElementById('items');
const form = document.getElementById('item-form');
const errorBox = document.getElementById('error');

async function api(path, options = {}) {
  const res = await fetch(`/api/items${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function load() {
  try {
    const items = await api('');
    errorBox.textContent = '';
    list.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="name"></span>
        <button class="small" data-change="-1">-</button>
        <strong>${item.quantity}</strong>
        <button class="small" data-change="1">+</button>
        <button class="small delete">Delete</button>`;
      li.querySelector('.name').textContent = item.name;
      li.querySelectorAll('[data-change]').forEach((btn) =>
        btn.addEventListener('click', () =>
          update(item, Math.max(0, item.quantity + Number(btn.dataset.change)))
        )
      );
      li.querySelector('.delete').addEventListener('click', () => remove(item.id));
      list.appendChild(li);
    }
    if (!items.length) list.innerHTML = '<li>No items yet</li>';
  } catch (err) {
    errorBox.textContent = 'Cannot reach backend: ' + err.message;
  }
}

async function update(item, quantity) {
  await api(`/${item.id}`, { method: 'PUT', body: JSON.stringify({ name: item.name, quantity }) });
  load();
}

async function remove(id) {
  await api(`/${id}`, { method: 'DELETE' });
  load();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const quantity = Number(document.getElementById('quantity').value) || 0;
  await api('', { method: 'POST', body: JSON.stringify({ name, quantity }) });
  form.reset();
  load();
});

load();
