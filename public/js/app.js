(function () {
  'use strict';

  const CART_KEY = 'cloudplate_cart';
  const FREE_DELIVERY_ABOVE = 499;
  const DELIVERY_FEE = 39;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
  const rupees = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

  let cart = loadCart();

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    renderCart();
  }

  function cartCount() {
    return cart.reduce((sum, line) => sum + line.quantity, 0);
  }

  function subtotal() {
    return cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  }

  function addToCart(data) {
    const id = Number(data.id);
    const existing = cart.find((line) => line.id === id);
    if (existing) existing.quantity += 1;
    else cart.push({
      id,
      name: data.name,
      price: Number(data.price),
      image: data.image,
      quantity: 1
    });
    saveCart();
    openCart();
  }

  function changeQuantity(id, delta) {
    const line = cart.find((item) => item.id === Number(id));
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) cart = cart.filter((item) => item.id !== Number(id));
    saveCart();
  }

  function renderCart() {
    const container = $('#cart-items');
    if (!container) return;

    $('#cart-count').textContent = cartCount();

    if (!cart.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍽️</div>
          <h3>Your cart is empty</h3>
          <p class="small">Add something delicious from our menu to get started.</p>
          <a href="/menu" class="btn btn-sm btn-outline" data-close-cart>Browse the menu</a>
        </div>`;
    } else {
      container.innerHTML = cart.map((line) => `
        <div class="cart-line">
          <img src="${escapeHtml(line.image)}" alt="" onerror="this.style.visibility='hidden'">
          <div class="cart-line-info">
            <strong>${escapeHtml(line.name)}</strong>
            <span>${rupees(line.price)} each</span>
            <div class="qty-control">
              <button type="button" data-qty-minus="${line.id}" aria-label="Decrease quantity">−</button>
              <span>${line.quantity}</span>
              <button type="button" data-qty-plus="${line.id}" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <strong class="small">${rupees(line.price * line.quantity)}</strong>
        </div>`).join('');
    }

    const sub = subtotal();
    const delivery = !cart.length || sub >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
    $('#cart-subtotal').textContent = rupees(sub);
    $('#cart-delivery').textContent = delivery === 0 ? 'FREE' : rupees(delivery);
    $('#cart-total').textContent = rupees(sub + delivery);
    const placeBtn = $('#place-order-btn');
    if (placeBtn) placeBtn.disabled = !cart.length;
  }

  function openCart() {
    $('#cart-drawer')?.classList.add('open');
    $('#cart-drawer')?.setAttribute('aria-hidden', 'false');
    if ($('#cart-overlay')) $('#cart-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeCart() {
    $('#cart-drawer')?.classList.remove('open');
    $('#cart-drawer')?.setAttribute('aria-hidden', 'true');
    if ($('#cart-overlay')) $('#cart-overlay').hidden = true;
    document.body.style.overflow = '';
  }

  function showSuccess(orderNumber, eta, trackUrl) {
    $('#success-order').textContent = orderNumber;
    $('#success-eta').textContent = `${eta} min`;
    $('#success-track').setAttribute('href', trackUrl);
    const copyBtn = $('#copy-order-btn');
    if (copyBtn) { copyBtn.textContent = 'Copy'; copyBtn.disabled = false; }
    const modal = $('#success-modal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  document.addEventListener('click', (event) => {
    const addBtn = event.target.closest('[data-add]');
    if (addBtn) {
      addToCart(addBtn.dataset);
      const original = addBtn.innerHTML;
      addBtn.innerHTML = 'Added ✓';
      setTimeout(() => { addBtn.innerHTML = original; }, 1100);
      return;
    }

    if (event.target.closest('#cart-toggle')) { openCart(); return; }
    if (event.target.closest('#cart-close') || event.target.closest('#cart-overlay') || event.target.closest('[data-close-cart]')) { closeCart(); return; }
    if (event.target.closest('#success-close') || (event.target.closest('#success-modal') && !event.target.closest('.modal-card'))) {
      $('#success-modal').hidden = true;
      document.body.style.overflow = '';
      return;
    }

    const copyBtn = event.target.closest('#copy-order-btn');
    if (copyBtn) {
      event.preventDefault();
      event.stopPropagation();
      const orderNumber = $('#success-order').textContent.trim();
      if (!orderNumber || orderNumber === 'CK-...') return;
      const original = copyBtn.dataset.label || copyBtn.textContent;
      copyBtn.dataset.label = original;
      const setState = (text) => { copyBtn.textContent = text; setTimeout(() => { copyBtn.textContent = original; }, 1500); };

      const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = orderNumber;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, orderNumber.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        setState(ok ? 'Copied!' : 'Copy failed');
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(orderNumber).then(() => setState('Copied!')).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
      return;
    }

    const plus = event.target.closest('[data-qty-plus]');
    if (plus) { changeQuantity(plus.dataset.qtyPlus, 1); return; }
    const minus = event.target.closest('[data-qty-minus]');
    if (minus) { changeQuantity(minus.dataset.qtyMinus, -1); return; }

    const flashClose = event.target.closest('.flash-close');
    if (flashClose) { flashClose.closest('.flash').remove(); return; }

    const navToggle = event.target.closest('#nav-toggle');
    if (navToggle) {
      const nav = $('#main-nav');
      nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    }

    const navLink = event.target.closest('#main-nav a');
    if (navLink && window.matchMedia('(max-width: 820px)').matches) {
      const nav = $('#main-nav');
      nav.classList.remove('open');
      const toggle = $('#nav-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('#success-modal') && !$('#success-modal').hidden) {
      $('#success-modal').hidden = true;
      document.body.style.overflow = '';
    } else {
      closeCart();
    }
  });

  const form = $('#checkout-form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#checkout-error');
      const button = $('#place-order-btn');
      errorBox.hidden = true;

      if (!cart.length) {
        errorBox.textContent = 'Your cart is empty.';
        errorBox.hidden = false;
        return;
      }
      const data = new FormData(form);
      const phone = String(data.get('phone') || '').replace(/\D/g, '');
      if (phone.length < 10) {
        errorBox.textContent = 'Please enter a valid 10-digit phone number.';
        errorBox.hidden = false;
        return;
      }

      button.disabled = true;
      button.textContent = 'Placing order…';

      try {
        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: {
              name: data.get('name'),
              phone: data.get('phone'),
              email: data.get('email'),
              address: data.get('address')
            },
            notes: data.get('notes'),
            payment_method: data.get('payment_method'),
            items: cart.map((line) => ({ id: line.id, quantity: line.quantity }))
          })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not place order.');

        cart = [];
        localStorage.removeItem(CART_KEY);
        renderCart();
        form.reset();
        closeCart();
        showSuccess(result.orderNumber, result.estimatedMinutes, result.trackUrl);
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = 'Place order';
      }
    });
  }

  function initReviewsCarousel() {
    const track = $('#reviews-track');
    if (!track) return;

    const cards = Array.from(track.children);
    const prev = $('[data-review-prev]');
    const next = $('[data-review-next]');
    const dots = $('#reviews-dots');
    let index = 0;

    const perView = () => (window.innerWidth <= 600 ? 1 : window.innerWidth <= 1020 ? 2 : 3);
    const maxIndex = () => Math.max(0, cards.length - perView());

    function render() {
      index = Math.min(index, maxIndex());
      const styles = getComputedStyle(track);
      const gap = parseFloat(styles.columnGap) || parseFloat(styles.gap) || 0;
      const step = cards.length ? cards[0].getBoundingClientRect().width + gap : 0;
      track.style.transform = `translateX(-${index * step}px)`;

      const noSliding = maxIndex() === 0;
      prev.hidden = noSliding;
      next.hidden = noSliding;
      prev.disabled = index === 0;
      next.disabled = index >= maxIndex();

      if (dots) {
        dots.innerHTML = '';
        for (let i = 0; i <= maxIndex(); i += 1) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.setAttribute('aria-label', `Show review slide ${i + 1}`);
          if (i === index) dot.className = 'active';
          dot.addEventListener('click', () => { index = i; render(); });
          dots.appendChild(dot);
        }
      }
    }

    prev.addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
    next.addEventListener('click', () => { if (index < maxIndex()) { index += 1; render(); } });
    window.addEventListener('resize', render);
    render();
  }

  function initOfferCarousel() {
    $$('.offer-banner').forEach((banner) => {
      const track = banner.querySelector('.offer-track');
      const prev = banner.querySelector('.offer-prev');
      const next = banner.querySelector('.offer-next');
      const counter = banner.querySelector('.offer-counter');
      if (!track || !prev || !next || !track.children.length) return;

      const total = track.children.length;
      let index = 0;

      function render() {
        index = Math.max(0, Math.min(index, total - 1));
        track.style.transform = `translateX(-${index * 100}%)`;
        if (counter) counter.textContent = `${index + 1} / ${total}`;
        prev.disabled = index === 0;
        next.disabled = index === total - 1;
      }

      prev.addEventListener('click', () => { index -= 1; render(); });
      next.addEventListener('click', () => { index += 1; render(); });
      render();
    });
  }

  function initDietFilters() {
    const veg = document.querySelector('input[name="veg"]');
    const nonveg = document.querySelector('input[name="nonveg"]');
    if (!veg || !nonveg) return;
    veg.addEventListener('change', () => { if (veg.checked) nonveg.checked = false; });
    nonveg.addEventListener('change', () => { if (nonveg.checked) veg.checked = false; });
  }

  function initAuthTabs() {
    const tabs = Array.from(document.querySelectorAll('[data-auth-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-auth-panel]'));
    if (!tabs.length || !panels.length) return;
    const show = (mode) => {
      tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.authTab === mode));
      panels.forEach((panel) => { panel.hidden = panel.dataset.authPanel !== mode; });
      const url = new URL(window.location.href);
      url.searchParams.set('mode', mode);
      window.history.replaceState({}, '', url);
    };
    tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.authTab)));
  }

  initAuthTabs();
  initDietFilters();
  initReviewsCarousel();
  initOfferCarousel();
  renderCart();
})();
