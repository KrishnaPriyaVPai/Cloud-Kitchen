const BASE = process.env.BASE_URL || 'http://localhost:3000';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual'
  });
}

async function postForm(path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {})
    },
    body: new URLSearchParams(body),
    redirect: 'manual'
  });
}

function cookieFrom(response) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (!values.length) return '';
  return values.map((value) => value.split(';')[0]).join('; ');
}

(async () => {
  const publicPages = ['/', '/about', '/menu', '/contact', '/track', '/login'];
  for (const page of publicPages) {
    const response = await get(page);
    check(`GET ${page}`, response.status === 200, `status ${response.status}`);
  }

  const login = await postForm('/login', {
    email: 'chef@cloudplate.in',
    password: 'Chef@1234'
  });
  const chefCookie = cookieFrom(login);
  check('Chef login redirects', login.status === 302 && login.headers.get('location') === '/chef', `status ${login.status}, location ${login.headers.get('location')}`);

  const chefPages = [
    '/chef', '/chef/menu', '/chef/menu/new', '/chef/orders', '/chef/orders/1',
    '/chef/reviews', '/chef/staff', '/chef/messages', '/chef/settings'
  ];
  for (const page of chefPages) {
    const response = await get(page, chefCookie);
    check(`GET ${page}`, response.status === 200, `status ${response.status}`);
  }

  const riderLogin = await postForm('/login', {
    email: 'ravi@cloudplate.in',
    password: 'Ravi@1234'
  });
  const riderCookie = cookieFrom(riderLogin);
  check('Delivery login redirects', riderLogin.status === 302 && riderLogin.headers.get('location') === '/delivery', `status ${riderLogin.status}`);

  const riderPages = ['/delivery', '/delivery/orders', '/delivery/orders/2', '/delivery/profile'];
  for (const page of riderPages) {
    const response = await get(page, riderCookie);
    check(`GET ${page}`, response.status === 200, `status ${response.status}`);
  }

  const menu = await (await get('/menu')).text();
  check('Menu renders dish cards', menu.includes('data-add'));

  const checkout = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: {
        name: 'Smoke Test Customer',
        phone: '+91 90000 00000',
        email: 'smoke@example.com',
        address: '1 Test Street, Bengaluru'
      },
      items: [{ id: 1, quantity: 1 }, { id: 15, quantity: 2 }],
      notes: 'Automated smoke test order',
      payment_method: 'cod'
    })
  });
  const checkoutBody = await checkout.json();
  check('Checkout creates order', checkout.status === 200 && checkoutBody.ok === true, JSON.stringify(checkoutBody));

  if (checkoutBody.ok) {
    const track = await get(checkoutBody.trackUrl);
    const trackHtml = await track.text();
    check('Tracking page shows order', track.status === 200 && trackHtml.includes(checkoutBody.orderNumber));
  }

  const failed = results.filter((r) => !r.ok);
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail && !result.ok ? ` — ${result.detail}` : ''}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
