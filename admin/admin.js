(() => {
  const loginView = document.querySelector("#login");
  const appView = document.querySelector("#app");
  const content = document.querySelector("#content");
  const notice = document.querySelector("#notice");
  const title = document.querySelector("#page-title");
  const dialog = document.querySelector("#task-dialog");
  const taskForm = document.querySelector("#task-form");
  const bannerDialog = document.querySelector("#banner-dialog");
  const bannerForm = document.querySelector("#banner-form");
  const affiliateDialog = document.querySelector("#affiliate-dialog");
  const affiliateForm = document.querySelector("#affiliate-form");
  const redeemCardDialog = document.querySelector("#redeem-card-dialog");
  const redeemCardForm = document.querySelector("#redeem-card-form");
  const state = { page: "overview", userPage: 1, withdrawalPage: 1, providers: [] };
  const titles = {
    overview: "Overview",
    users: "Users",
    tasks: "Tasks & rewards",
    banners: "Posters",
    affiliate: "Affiliate posts",
    "redeem-cards": "Redeem cards",
    withdrawals: "Redemption requests",
    "app-content": "App information",
    providers: "Providers",
    audit: "Audit log",
  };
  let noticeTimer;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  const number = (value) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value) || 0);

  const api = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}) };
    if (method !== "GET" && method !== "HEAD") headers["X-Admin-Request"] = "true";
    let response;
    try {
      response = await fetch(`/admin/api${path}`, {
        ...options,
        method,
        headers: { ...headers, ...(options.headers || {}) },
        credentials: "same-origin",
      });
    } catch {
      throw new Error("Could not reach the backend. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== "/login" && path !== "/session") showLogin();
      throw new Error(data.message || `Request failed (${response.status}).`);
    }
    return data;
  };

  const notify = (message, isError = false) => {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.classList.remove("hidden");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.add("hidden"), 5000);
  };

  const showLogin = () => {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
  };

  const showApp = () => {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    renderPage();
  };

  const showError = (error) => {
    content.innerHTML = `<div class="panel empty">${escapeHtml(error.message || "Something went wrong.")}<p><button class="button" id="retry">Try again</button></p></div>`;
    document.querySelector("#retry")?.addEventListener("click", renderPage);
  };

  const statCard = (label, value, foot = "") => `
    <article class="stat-card"><p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value">${escapeHtml(number(value))}</p>
      <p class="stat-foot">${escapeHtml(foot)}</p></article>`;

  async function renderOverview() {
    const { stats } = await api("/dashboard");
    content.innerHTML = `
      <div class="page-heading"><div><h2>Business at a glance</h2><p>Live totals from your RewardBrick database.</p></div></div>
      <section class="stats-grid">
        ${statCard("Total users", stats.total_users, `${number(stats.active_users)} active accounts`)}
        ${statCard("Coins outstanding", stats.outstanding_coins, "Current combined user balances")}
        ${statCard("Pending payouts", stats.pending_withdrawals, `${number(stats.completed_withdrawals)} completed`)}
        ${statCard("Managed tasks", stats.active_managed_tasks, `${number(stats.total_managed_tasks)} total tasks`)}
        ${statCard("Lifetime coin credits", stats.lifetime_credits, "All positive ledger entries")}
        ${statCard("Lifetime coin debits", stats.lifetime_debits, "All negative ledger entries")}
      </section>
      <section class="panel"><h3>Before launch</h3>
        <p class="muted small">Set ADMIN_PANEL_PASSWORD on the backend and deploy this backend. AdMob production IDs, provider postback secrets, payment operations and Android/iOS store setup still need your own verified accounts and configuration.</p>
      </section>`;
  }

  async function renderUsers() {
    const query = new URLSearchParams({
      page: String(state.userPage),
      limit: "20",
      q: document.querySelector("#user-search")?.value || "",
      status: document.querySelector("#user-status")?.value || "all",
    });
    const data = await api(`/users?${query}`);
    content.innerHTML = `
      <div class="page-heading"><div><h2>Account management</h2><p>Search user accounts, suspend access, or record a reasoned coin adjustment.</p></div></div>
      <section class="panel">
        <div class="panel-head"><h3>${number(data.total)} accounts</h3>
          <form id="user-filters" class="toolbar">
            <input id="user-search" name="q" placeholder="Search name, email or ID" value="${escapeHtml(document.querySelector("#user-search")?.value || "")}">
            <select id="user-status" name="status">
              <option value="all">All users</option><option value="active">Active</option><option value="suspended">Suspended</option>
            </select>
            <button class="button" type="submit">Search</button>
          </form>
        </div>
        <div class="table-wrap"><table><thead><tr><th>User</th><th>Balance</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${data.users.map((user) => `
          <tr><td><strong>${escapeHtml(user.full_name || "Unnamed user")}</strong><span class="subline">${escapeHtml(user.email || user.user_id)}<br>${escapeHtml(user.user_id)}</span></td>
          <td>${number(user.wallet_balance)} coins</td><td>${escapeHtml(date(user.created_at))}</td>
          <td><span class="badge ${user.is_active ? "" : "off"}">${user.is_active ? "Active" : "Suspended"}</span></td>
          <td><div class="actions">
            <button class="button small-button" data-adjust="${escapeHtml(user.user_id)}">Adjust coins</button>
            <button class="button small-button ${user.is_active ? "danger" : ""}" data-status="${escapeHtml(user.user_id)}" data-active="${!user.is_active}">${user.is_active ? "Suspend" : "Reactivate"}</button>
          </div></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No matching accounts.</td></tr>`}
        </tbody></table></div>
        ${pagination(state.userPage, data.total, 20, "user-page")}</section>`;

    document.querySelector("#user-status").value =
      new URLSearchParams(query).get("status") || "all";
    document.querySelector("#user-filters").addEventListener("submit", (event) => {
      event.preventDefault();
      state.userPage = 1;
      renderUsers().catch(showError);
    });
    document.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const active = button.dataset.active === "true";
        if (!confirm(`${active ? "Reactivate" : "Suspend"} this account?`)) return;
        try {
          await api(`/users/${encodeURIComponent(button.dataset.status)}/status`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: active }),
          });
          notify(`Account ${active ? "reactivated" : "suspended"}.`);
          renderUsers().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
    document.querySelectorAll("[data-adjust]").forEach((button) => {
      button.addEventListener("click", async () => {
        const rawAmount = prompt("Enter a whole number of coins (use a minus sign to remove coins):");
        if (rawAmount === null) return;
        const amount = Number(rawAmount);
        if (!Number.isSafeInteger(amount) || amount === 0) {
          notify("Enter a non-zero whole number of coins.", true);
          return;
        }
        const reason = prompt("Why are you adjusting this balance? This is saved to the audit log:");
        if (reason === null) return;
        try {
          await api(`/users/${encodeURIComponent(button.dataset.adjust)}/coins`, {
            method: "POST",
            body: JSON.stringify({ amount, reason }),
          });
          notify("Coin adjustment saved to the transaction ledger.");
          renderUsers().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
    document.querySelectorAll("[data-user-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.userPage = Number(button.dataset.userPage);
        renderUsers().catch(showError);
      });
    });
  }

  async function renderTasks() {
    const [data, providers, legacy] = await Promise.all([
      api("/tasks"),
      api("/providers"),
      api("/tasks/legacy"),
    ]);
    state.providers = providers.providers;
    content.innerHTML = `
      <div class="page-heading"><div><h2>Tasks &amp; rewards</h2><p>Manage offer links and the coin amounts displayed in the app.</p></div>
      <button id="add-task" class="button primary">Add task</button></div>
      <section class="panel"><div class="panel-head"><h3>Admin-managed offers</h3><span class="badge">${number(data.tasks.length)} offers</span></div><div class="table-wrap"><table><thead><tr><th>Task</th><th>Provider</th><th>Reward</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.tasks.map((task) => `<tr>
        <td><strong>${escapeHtml(task.title)}</strong><span class="subline">${escapeHtml(task.offer_url)}</span></td>
        <td>${escapeHtml(task.provider_name)}</td><td>${number(task.reward_coins)} coins</td>
        <td><span class="badge ${task.is_active ? "" : "off"}">${task.is_active ? "Active" : "Paused"}</span></td>
        <td><button class="button small-button" data-edit-task="${task.id}">Edit</button></td>
      </tr>`).join("") || `<tr><td colspan="5" class="empty">No managed tasks yet. Add one to display it in the app.</td></tr>`}</tbody>
      </table></div></section>
      <section class="panel"><div class="panel-head"><div><h3>Existing backend tasks</h3><p class="muted small">Legacy task rows already used by the Flutter app; at most 200 shown.</p></div></div>
      ${legacy.editable ? `<div class="table-wrap"><table><thead><tr><th>Task</th><th>Provider</th><th>Link</th><th>Display reward</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${legacy.tasks.map((task) => `<tr>
        <td><strong>${escapeHtml(task.title)}</strong><span class="subline">ID: ${escapeHtml(task.id)}</span></td>
        <td>${escapeHtml(task.provider || "—")}</td><td class="subline">${escapeHtml(task.offer_url || "—")}</td>
        <td>${number(task.reward_coins)} coins</td>
        <td><span class="badge ${task.is_active ? "" : "off"}">${task.is_active ? "Active" : "Paused"}</span></td>
        <td><div class="actions">
          ${task.can_toggle ? `<button class="button small-button ${task.is_active ? "danger" : ""}" data-legacy-status="${escapeHtml(task.id)}" data-active="${!task.is_active}">${task.is_active ? "Pause" : "Activate"}</button>` : ""}
          ${task.can_edit_reward ? `<button class="button small-button" data-legacy-reward="${escapeHtml(task.id)}">Set coins</button>` : ""}
        </div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No legacy tasks found.</td></tr>`}</tbody></table></div>`
        : `<p class="muted small">${escapeHtml(legacy.message || "Legacy task rows could not be edited.")}</p>`}
      </section>
      <section class="panel"><h3>Reward flow note</h3><p class="muted small">Displayed task coins do not prove completion. External task coins are credited only by a valid provider postback, using the configured provider reward. Provider-level fixed rewards are managed in Providers.</p></section>`;
    document.querySelector("#add-task").addEventListener("click", () => openTaskDialog(null));
    document.querySelectorAll("[data-edit-task]").forEach((button) => {
      button.addEventListener("click", () => {
        const task = data.tasks.find((item) => item.id === Number(button.dataset.editTask));
        openTaskDialog(task);
      });
    });
    document.querySelectorAll("[data-legacy-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const active = button.dataset.active === "true";
        try {
          await api(`/tasks/legacy/${encodeURIComponent(button.dataset.legacyStatus)}`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: active }),
          });
          notify(`Existing task ${active ? "activated" : "paused"}.`);
          renderTasks().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
    document.querySelectorAll("[data-legacy-reward]").forEach((button) => {
      button.addEventListener("click", async () => {
        const rawReward = prompt("Set the display reward in whole coins:");
        if (rawReward === null) return;
        const reward = Number(rawReward);
        if (!Number.isSafeInteger(reward) || reward < 0) {
          notify("Enter a non-negative whole number of coins.", true);
          return;
        }
        try {
          await api(`/tasks/legacy/${encodeURIComponent(button.dataset.legacyReward)}`, {
            method: "PATCH",
            body: JSON.stringify({ reward_coins: reward }),
          });
          notify("Display reward updated.");
          renderTasks().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  async function renderWithdrawals() {
    const status = document.querySelector("#withdrawal-status")?.value || "pending";
    const query = new URLSearchParams({ page: String(state.withdrawalPage), limit: "20", status });
    const data = await api(`/withdrawals?${query}`);
    content.innerHTML = `
      <div class="page-heading"><div><h2>Gift-card redemption queue</h2><p>Review requests by user. Add the voucher code/reference when you have sent the gift card; failed requests refund coins.</p></div>
        <div class="toolbar"><select id="withdrawal-status"><option value="pending">Pending</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="all">All</option></select></div>
      </div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>User</th><th>Coins</th><th>Method / destination</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.withdrawals.map((item) => `<tr>
        <td><strong>${escapeHtml(item.full_name || "User")}</strong><span class="subline">${escapeHtml(item.email || item.user_id)}</span></td>
        <td>${number(item.amount_coins)} coins</td>
        <td>${escapeHtml(item.card_title || item.method)}<span class="subline">₹${number(item.denomination_inr)} card · ${number(item.amount_coins)} coins</span>${item.voucher_reference ? `<span class="subline">Voucher: ${escapeHtml(item.voucher_reference)}</span>` : ""}</td>
        <td>${escapeHtml(date(item.created_at))}</td><td><span class="badge ${item.status === "pending" ? "warn" : item.status === "failed" ? "off" : ""}">${escapeHtml(item.status)}</span></td>
        <td>${item.status === "pending" ? `<div class="actions"><button class="button small-button" data-withdrawal="${item.id}" data-next="completed">Send voucher</button><button class="button small-button danger" data-withdrawal="${item.id}" data-next="failed">Fail &amp; refund</button></div>` : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">No withdrawal requests found.</td></tr>`}</tbody></table></div>
      ${pagination(state.withdrawalPage, data.total, 20, "withdrawal-page")}</section>`;
    document.querySelector("#withdrawal-status").value = status;
    document.querySelector("#withdrawal-status").addEventListener("change", () => {
      state.withdrawalPage = 1;
      renderWithdrawals().catch(showError);
    });
    document.querySelectorAll("[data-withdrawal]").forEach((button) => {
      button.addEventListener("click", async () => {
        const next = button.dataset.next;
      const voucherReference = next === "completed"
        ? prompt("Enter the voucher code/reference that you have sent to this user:")
        : "";
      if (next === "completed" && voucherReference === null) return;
      if (next === "completed" && voucherReference.trim().length < 4) {
        notify("Enter the voucher code/reference before completing the request.", true);
        return;
      }
      if (!confirm(next === "completed"
        ? "Confirm that this voucher has been sent to the user?"
        : "Mark this request failed and refund the coins to the user?")) return;
      try {
        await api(`/withdrawals/${button.dataset.withdrawal}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next, voucher_reference: voucherReference }),
        });
        notify(next === "failed" ? "Request failed; coins were refunded." : "Voucher recorded and request completed.");
          renderWithdrawals().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
    document.querySelectorAll("[data-withdrawal-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.withdrawalPage = Number(button.dataset.withdrawalPage);
        renderWithdrawals().catch(showError);
      });
    });
  }

  async function renderProviders() {
    const { providers } = await api("/providers");
    state.providers = providers;
    content.innerHTML = `
      <div class="page-heading"><div><h2>Provider configuration</h2><p>Set callback URLs, coin rewards and provider postback secrets.</p></div></div>
      <section class="provider-grid">${providers.map((provider) => `
        <article class="provider-card"><h3>${escapeHtml(provider.provider_name.replaceAll("_", " "))}</h3>
          <form data-provider="${escapeHtml(provider.provider_name)}">
            <label>Offer / tracking base URL<input name="base_url" type="url" value="${escapeHtml(provider.base_url)}" required></label>
            <label>Reward coins per valid callback<input name="reward_coins" type="number" min="0" max="1000000" step="1" value="${provider.reward_coins == null ? "" : escapeHtml(provider.reward_coins)}" placeholder="Provider payout conversion"></label>
            <label>New postback secret<input name="secret_key" type="password" minlength="12" autocomplete="new-password" placeholder="${provider.secret_configured ? "Secret is configured; leave blank to keep it" : "Enter the provider callback secret"}"></label>
            <p class="muted small">Current secret: ${provider.secret_configured ? "configured (hidden)" : "not configured"}</p>
            <button class="button primary" type="submit">Save provider</button>
          </form>
        </article>`).join("")}</section>
      <section class="panel"><h3>Conversion reminder</h3><p class="muted small">Current business rule: 10 coins = ₹1; AdMantum defaults to 400 coins per valid completion (₹40). If you change a provider reward, verify its real payout and task terms first.</p></section>`;
    document.querySelectorAll("[data-provider]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = new FormData(form);
        const body = {
          base_url: values.get("base_url"),
          reward_coins: values.get("reward_coins") === "" ? null : Number(values.get("reward_coins")),
        };
        const secret = values.get("secret_key");
        if (secret) body.secret_key = secret;
        try {
          await api(`/providers/${encodeURIComponent(form.dataset.provider)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          form.elements.secret_key.value = "";
          notify("Provider settings saved. Secrets remain hidden.");
          renderProviders().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  async function renderAudit() {
    const { events } = await api("/audit-log?page=1&limit=100");
    content.innerHTML = `
      <div class="page-heading"><div><h2>Admin audit log</h2><p>Recent account, wallet, withdrawal, task and provider changes.</p></div></div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
      <tbody>${events.map((event) => `<tr><td>${escapeHtml(date(event.created_at))}</td><td><span class="badge">${escapeHtml(event.action)}</span></td>
      <td>${escapeHtml(event.target_type)}<span class="subline">${escapeHtml(event.target_id)}</span></td>
      <td class="audit-details">${escapeHtml(JSON.stringify(event.details))}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No admin actions recorded yet.</td></tr>`}</tbody></table></div></section>`;
  }

  async function renderAffiliatePosts() {
    const { posts } = await api("/affiliate-posts");
    content.innerHTML = `
      <div class="page-heading"><div><h2>Affiliate marketing</h2><p>Only posts created here are shown in the app. Add real product text, imagery and tracked destination links.</p></div>
        <button class="button primary" id="add-affiliate-post">Add post</button></div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Post</th><th>Destination</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${posts.map((post) => `<tr>
        <td><strong>${escapeHtml(post.title)}</strong><span class="subline">${escapeHtml(post.message)}</span>${post.image_url ? `<span class="subline">Image configured</span>` : ""}</td>
        <td class="audit-details">${escapeHtml(post.destination_url)}</td><td>${number(post.sort_order)}</td>
        <td><span class="badge ${post.is_active ? "" : "off"}">${post.is_active ? "Active" : "Paused"}</span></td>
        <td><div class="actions"><button class="button small-button" data-edit-affiliate="${post.id}">Edit</button><button class="button small-button danger" data-delete-affiliate="${post.id}">Delete</button></div></td>
      </tr>`).join("") || `<tr><td colspan="5" class="empty">No affiliate posts created. Add verified content to publish it to the app.</td></tr>`}</tbody></table></div></section>`;
    document.querySelector("#add-affiliate-post").addEventListener("click", () => openAffiliateDialog());
    document.querySelectorAll("[data-edit-affiliate]").forEach((button) => {
      button.addEventListener("click", () => {
        const post = posts.find((item) => item.id === Number(button.dataset.editAffiliate));
        if (post) openAffiliateDialog(post);
      });
    });
    document.querySelectorAll("[data-delete-affiliate]").forEach((button) => {
      button.addEventListener("click", async () => {
        const post = posts.find((item) => item.id === Number(button.dataset.deleteAffiliate));
        if (!post || !confirm(`Delete "${post.title}"?`)) return;
        try {
          await api(`/affiliate-posts/${post.id}`, { method: "DELETE" });
          notify("Affiliate post deleted.");
          renderAffiliatePosts().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  function openAffiliateDialog(post) {
    affiliateForm.reset();
    affiliateForm.elements.id.value = post?.id || "";
    affiliateForm.elements.title.value = post?.title || "";
    affiliateForm.elements.message.value = post?.message || "";
    affiliateForm.elements.image_url.value = post?.image_url || "";
    affiliateForm.elements.destination_url.value = post?.destination_url || "";
    affiliateForm.elements.sort_order.value = post?.sort_order ?? 0;
    affiliateForm.elements.is_active.checked = post?.is_active ?? true;
    document.querySelector("#affiliate-dialog-title").textContent = post ? "Edit post" : "Add post";
    affiliateDialog.showModal();
  }

  async function renderRedeemCards() {
    const { cards } = await api("/redeem-cards");
    content.innerHTML = `
      <div class="page-heading"><div><h2>Gift-card catalog</h2><p>Active cards are offered in the app. Conversion is 10 coins per ₹1; fulfilled vouchers are entered in the redemption queue.</p></div>
        <button class="button primary" id="add-redeem-card">Add gift card</button></div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Provider</th><th>Value</th><th>Coins</th><th>Minimum balance</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${cards.map((card) => `<tr>
        <td><strong>${escapeHtml(card.title)}</strong></td><td>₹${number(card.denomination_inr)}</td>
        <td>${number(card.coins_required)}</td><td>${number(card.minimum_coins)}</td>
        <td><span class="badge ${card.is_active ? "" : "off"}">${card.is_active ? "Available" : "Paused"}</span></td>
        <td>${card.is_active ? `<div class="actions"><button class="button small-button" data-edit-redeem-card="${card.id}">Edit</button><button class="button small-button danger" data-disable-redeem-card="${card.id}">Disable</button></div>` : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">No gift cards configured. Add only vouchers you can fulfill.</td></tr>`}</tbody></table></div></section>`;
    document.querySelector("#add-redeem-card").addEventListener("click", () => openRedeemCardDialog());
    document.querySelectorAll("[data-edit-redeem-card]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = cards.find((item) => item.id === Number(button.dataset.editRedeemCard));
        if (card) openRedeemCardDialog(card);
      });
    });
    document.querySelectorAll("[data-disable-redeem-card]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = cards.find((item) => item.id === Number(button.dataset.disableRedeemCard));
        if (!card || !confirm(`Stop offering "${card.title}"? Existing requests are not changed.`)) return;
        try {
          await api(`/redeem-cards/${card.id}`, { method: "DELETE" });
          notify("Gift card disabled.");
          renderRedeemCards().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  async function renderAppContent() {
    const { content: items = [] } = await api("/app-content");
    const values = Object.fromEntries(items.map((item) => [item.content_key, item.content]));
    const sections = [
      ["terms", "Terms & conditions", "Published terms displayed in the app profile."],
      ["about", "About us", "Published About Us information displayed in the app profile."],
      ["support_email", "Support email", "Used by the app's Bug report action. Leave blank to disable it."],
      ["store_url", "App store URL", "HTTPS Play Store or App Store URL used by Rate us. Leave blank to disable it."],
    ];
    content.innerHTML = `
      <div class="page-heading"><div><h2>App information</h2><p>Only content entered here is shown to users; blank content stays unpublished.</p></div></div>
      <section class="provider-grid">${sections.map(([key, label, help]) => `
        <article class="provider-card"><h3>${escapeHtml(label)}</h3>
          <form data-app-content="${key}">
            <label>${escapeHtml(help)}<textarea name="content" rows="${key === "terms" || key === "about" ? "8" : "2"}" maxlength="20000">${escapeHtml(values[key] || "")}</textarea></label>
            <button class="button primary" type="submit">Save ${escapeHtml(label.toLowerCase())}</button>
          </form>
        </article>`).join("")}</section>`;
    document.querySelectorAll("[data-app-content]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api(`/app-content/${encodeURIComponent(form.dataset.appContent)}`, {
            method: "PUT",
            body: JSON.stringify({ content: form.elements.content.value }),
          });
          notify(`${form.dataset.appContent.replaceAll("_", " ")} saved.`);
          renderAppContent().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  function openRedeemCardDialog(card) {
    redeemCardForm.reset();
    redeemCardForm.elements.id.value = card?.id || "";
    redeemCardForm.elements.title.value = card?.title || "";
    redeemCardForm.elements.denomination_inr.value = card?.denomination_inr || "";
    redeemCardForm.elements.minimum_coins.value = card?.minimum_coins ?? 1000;
    redeemCardForm.elements.sort_order.value = card?.sort_order ?? 0;
    redeemCardForm.elements.is_active.checked = card?.is_active ?? true;
    document.querySelector("#redeem-card-dialog-title").textContent = card ? "Edit gift card" : "Add gift card";
    redeemCardDialog.showModal();
  }

  async function renderBanners() {
    const { banners } = await api("/banners");
    content.innerHTML = `
      <div class="page-heading"><div><h2>App posters</h2><p>Active posters configured here are shown in the app home carousel. Empty catalog means no poster placeholder.</p></div>
        <button class="button primary" id="add-banner">Add poster</button></div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Poster</th><th>Image / destination</th><th>Color</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${banners.map((banner) => `<tr>
        <td><strong>${escapeHtml(banner.title)}</strong><span class="subline">${escapeHtml(banner.subtitle)}</span></td>
        <td>${banner.image_url ? "Image configured" : "No image"}${banner.target_url ? `<span class="subline">Tap destination configured</span>` : ""}</td>
        <td>${escapeHtml(banner.icon_name)} <span class="color-chip" style="background:${escapeHtml(banner.accent_color)}"></span> ${escapeHtml(banner.accent_color)}</td>
        <td>${number(banner.sort_order)}</td>
        <td><span class="badge ${banner.is_active ? "" : "off"}">${banner.is_active ? "Active" : "Paused"}</span></td>
        <td><div class="actions"><button class="button small-button" data-edit-banner="${banner.id}">Edit</button><button class="button small-button danger" data-delete-banner="${banner.id}">Delete</button></div></td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">No posters created. Add approved poster content here.</td></tr>`}</tbody></table></div></section>`;
    document.querySelector("#add-banner").addEventListener("click", () => openBannerDialog());
    document.querySelectorAll("[data-edit-banner]").forEach((button) => {
      button.addEventListener("click", () => {
        const banner = banners.find((item) => item.id === Number(button.dataset.editBanner));
        if (banner) openBannerDialog(banner);
      });
    });
    document.querySelectorAll("[data-delete-banner]").forEach((button) => {
      button.addEventListener("click", async () => {
        const banner = banners.find((item) => item.id === Number(button.dataset.deleteBanner));
        if (!banner || !confirm(`Delete "${banner.title}" from the dashboard?`)) return;
        try {
          await api(`/banners/${banner.id}`, { method: "DELETE" });
          notify("Dashboard card deleted.");
          renderBanners().catch(showError);
        } catch (error) { notify(error.message, true); }
      });
    });
  }

  function openBannerDialog(banner) {
    bannerForm.reset();
    bannerForm.elements.id.value = banner?.id || "";
    bannerForm.elements.title.value = banner?.title || "";
    bannerForm.elements.subtitle.value = banner?.subtitle || "";
    bannerForm.elements.icon_name.value = banner?.icon_name || "celebration";
    bannerForm.elements.accent_color.value = banner?.accent_color || "#00796b";
    bannerForm.elements.sort_order.value = banner?.sort_order ?? 0;
    bannerForm.elements.is_active.checked = banner?.is_active ?? true;
    bannerForm.elements.image_url.value = banner?.image_url || "";
    bannerForm.elements.target_url.value = banner?.target_url || "";
    document.querySelector("#banner-dialog-title").textContent = banner ? "Edit poster" : "Add poster";
    bannerDialog.showModal();
  }

  function pagination(page, total, pageSize, attribute) {
    if (total === undefined) {
      return `<div class="pagination"><button class="button small-button" data-${attribute}="${page + 1}">Next page</button></div>`;
    }
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `<div class="pagination"><span>Page ${page} of ${pages}</span>
      <button class="button small-button" data-${attribute}="${page - 1}" ${page <= 1 ? "disabled" : ""}>Previous</button>
      <button class="button small-button" data-${attribute}="${page + 1}" ${page >= pages ? "disabled" : ""}>Next</button></div>`;
  }

  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  }

  function openTaskDialog(task) {
    taskForm.reset();
    const providerSelect = taskForm.elements.provider_name;
    providerSelect.innerHTML = state.providers.map((provider) =>
      `<option value="${escapeHtml(provider.provider_name)}">${escapeHtml(provider.provider_name.replaceAll("_", " "))}</option>`
    ).join("");
    taskForm.elements.id.value = task?.id || "";
    taskForm.elements.title.value = task?.title || "";
    taskForm.elements.description.value = task?.description || "";
    taskForm.elements.provider_name.value = task?.provider_name || state.providers[0]?.provider_name || "";
    taskForm.elements.offer_url.value = task?.offer_url || "";
    taskForm.elements.image_url.value = task?.image_url || "";
    taskForm.elements.reward_coins.value = task?.reward_coins ?? 0;
    taskForm.elements.is_active.checked = task?.is_active ?? true;
    document.querySelector("#task-dialog-title").textContent = task ? "Edit task" : "Add task";
    dialog.showModal();
  }

  async function renderPage() {
    title.textContent = titles[state.page];
    document.querySelectorAll(".nav-link").forEach((link) =>
      link.classList.toggle("active", link.dataset.page === state.page)
    );
    const renderers = {
      overview: renderOverview,
      users: renderUsers,
      tasks: renderTasks,
      banners: renderBanners,
      affiliate: renderAffiliatePosts,
      "redeem-cards": renderRedeemCards,
      withdrawals: renderWithdrawals,
      "app-content": renderAppContent,
      providers: renderProviders,
      audit: renderAudit,
    };
    try { await renderers[state.page](); } catch (error) { showError(error); }
  }

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorLabel = document.querySelector("#login-error");
    const password = document.querySelector("#admin-password").value;
    errorLabel.textContent = "";
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ password }) });
      document.querySelector("#admin-password").value = "";
      showApp();
    } catch (error) { errorLabel.textContent = error.message; }
  });

  document.querySelector("#logout").addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST", body: "{}" });
    } catch (error) {
      notify(error.message, true);
    }
    showLogin();
  });

  document.querySelector("#navigation").addEventListener("click", (event) => {
    const link = event.target.closest("[data-page]");
    if (!link) return;
    state.page = link.dataset.page;
    renderPage();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) =>
    button.addEventListener("click", () => dialog.close())
  );
  document.querySelectorAll("[data-close-banner-dialog]").forEach((button) =>
    button.addEventListener("click", () => bannerDialog.close())
  );
  document.querySelectorAll("[data-close-affiliate-dialog]").forEach((button) =>
    button.addEventListener("click", () => affiliateDialog.close())
  );
  document.querySelectorAll("[data-close-redeem-card-dialog]").forEach((button) =>
    button.addEventListener("click", () => redeemCardDialog.close())
  );
  bannerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(bannerForm);
    const id = bannerForm.elements.id.value;
    const body = {
      title: values.get("title"),
      subtitle: values.get("subtitle"),
      icon_name: values.get("icon_name"),
      accent_color: values.get("accent_color"),
      image_url: values.get("image_url"),
      target_url: values.get("target_url"),
      sort_order: Number(values.get("sort_order")),
      is_active: bannerForm.elements.is_active.checked,
    };
    try {
      await api(id ? `/banners/${id}` : "/banners", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      bannerDialog.close();
      notify("Poster saved.");
      renderBanners().catch(showError);
    } catch (error) { notify(error.message, true); }
  });
  affiliateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(affiliateForm);
    const id = affiliateForm.elements.id.value;
    const body = {
      title: values.get("title"),
      message: values.get("message"),
      image_url: values.get("image_url"),
      destination_url: values.get("destination_url"),
      sort_order: Number(values.get("sort_order")),
      is_active: affiliateForm.elements.is_active.checked,
    };
    try {
      await api(id ? `/affiliate-posts/${id}` : "/affiliate-posts", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      affiliateDialog.close();
      notify("Affiliate post saved.");
      renderAffiliatePosts().catch(showError);
    } catch (error) { notify(error.message, true); }
  });
  redeemCardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(redeemCardForm);
    const id = redeemCardForm.elements.id.value;
    const body = {
      title: values.get("title"),
      denomination_inr: Number(values.get("denomination_inr")),
      minimum_coins: Number(values.get("minimum_coins")),
      sort_order: Number(values.get("sort_order")),
      is_active: redeemCardForm.elements.is_active.checked,
    };
    try {
      await api(id ? `/redeem-cards/${id}` : "/redeem-cards", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      redeemCardDialog.close();
      notify("Gift card saved.");
      renderRedeemCards().catch(showError);
    } catch (error) { notify(error.message, true); }
  });
  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(taskForm);
    const body = {
      title: values.get("title"),
      description: values.get("description"),
      provider_name: values.get("provider_name"),
      offer_url: values.get("offer_url"),
      image_url: values.get("image_url"),
      reward_coins: Number(values.get("reward_coins")),
      is_active: taskForm.elements.is_active.checked,
    };
    const id = taskForm.elements.id.value;
    try {
      await api(id ? `/tasks/${id}` : "/tasks", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      dialog.close();
      notify("Task saved. Verify the offer and postback before promoting it.");
      state.page = "tasks";
      renderPage();
    } catch (error) { notify(error.message, true); }
  });

  api("/session").then(showApp).catch(showLogin);
})();
