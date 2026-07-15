/* =========================================================
   app.js - Quản lý Danh sách Đảng viên Chi bộ
   ========================================================= */

/* ---------- CẤU HÌNH ---------- */
const API_URL = "/api/proxy";
const REQUIRED_FIELDS = ["STT", "Họ và tên", "CCCD"];
const EDITABLE_FIELDS = [
  "Họ và tên", "Ngày sinh", "Ngày vào đảng", "Ngày chính thức",
  "Dân tộc", "Tôn giáo", "CCCD", "Thẻ đảng viên", "Học vấn (Vd: 10/10, 12/12...)",
  "Chuyên môn", "LLCT", "Số điện thoại", "Chi bộ cũ",
  "Miễn sinh hoạt", "Nơi thường trú"
];

/* ---------- STATE ---------- */
let session = { role: null, cccd: null, password: null, adminPassword: null };
let members = [];
let filteredMembers = [];
let currentEdit = null;
let isAddMode = false;
let displayHeaders = [];

// Biến cho drag & drop cột
let dragItem = null;
let dragOverItem = null;

// Bộ lọc nâng cao
let advancedFilters = {
  ageDoi: null,      // { mode: 'exact'|'range'|'gte'|'lte', value: number, from: number, to: number }
  ageDang: null      // { mode: 'exact'|'range'|'gte'|'lte', value: number, from: number, to: number }
};

/* ---------- UTILITY ---------- */
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁️";
  }
}

function showMsg(elId, message, isError) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = message ? `<div class="msg ${isError ? "error" : "success"}">${message}</div>` : "";
}

function getAge(dateStr) {
  if (!dateStr) return null;
  try {
    let d;
    if (typeof dateStr === 'string') {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        d = new Date(dateStr);
      }
    } else if (dateStr instanceof Date) {
      d = dateStr;
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  } catch (e) { return null; }
}

function getPartyAge(joinDate) {
  if (!joinDate) return null;
  try {
    let d;
    if (typeof joinDate === 'string') {
      const parts = joinDate.split('/');
      if (parts.length === 3) {
        d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        d = new Date(joinDate);
      }
    } else if (joinDate instanceof Date) {
      d = joinDate;
    } else {
      d = new Date(joinDate);
    }
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  } catch (e) { return null; }
}

function getGivenName(fullName) {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}

function formatDate(date) {
  if (!date) return '';
  if (date instanceof Date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return String(date);
}

/* ---------- API ---------- */
async function apiCall(action, data) {
  const body = Object.assign({ action }, data || {});
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

/* ---------- TABS ---------- */
function switchTab(tab) {
  document.getElementById("tabMemberBtn").classList.toggle("active", tab === "member");
  document.getElementById("tabAdminBtn").classList.toggle("active", tab === "admin");
  document.getElementById("memberLoginForm").classList.toggle("hidden", tab !== "member");
  document.getElementById("adminLoginForm").classList.toggle("hidden", tab !== "admin");
}

/* ---------- LOGIN ---------- */
async function doMemberLogin() {
  const cccd = document.getElementById("memberCccdInput").value.trim();
  const password = document.getElementById("memberPasswordInput").value;
  if (!cccd) { showMsg("memberLoginMsg", "Vui lòng nhập số CCCD.", true); return; }

  showMsg("memberLoginMsg", "Đang xử lý...", false);
  try {
    const result = await apiCall("memberLogin", { cccd, password });
    if (result.success) {
      session = { role: "member", cccd, password: password || cccd };
      await loadAllMembers();
      showMsg("memberLoginMsg", "");
      enterMainScreen();
    } else if (result.requirePassword) {
      document.getElementById("memberPasswordField").classList.remove("hidden");
      showMsg("memberLoginMsg", result.message, true);
    } else {
      showMsg("memberLoginMsg", result.message || "Đăng nhập thất bại.", true);
    }
  } catch (err) {
    showMsg("memberLoginMsg", "Lỗi kết nối: " + err.message, true);
  }
}

async function doAdminLogin() {
  const password = document.getElementById("adminPasswordInput").value;
  showMsg("adminLoginMsg", "Đang xử lý...", false);
  try {
    const result = await apiCall("adminLogin", { password });
    if (result.success) {
      session = { role: "admin", adminPassword: password };
      showMsg("adminLoginMsg", "");
      await loadAllMembers();
      enterMainScreen();
    } else {
      showMsg("adminLoginMsg", result.message || "Sai mật khẩu.", true);
    }
  } catch (err) {
    showMsg("adminLoginMsg", "Lỗi kết nối: " + err.message, true);
  }
}

/* ---------- LOAD DATA ---------- */
async function loadAllMembers() {
  if (session.role === "admin") {
    const result = await apiCall("getAllMembers", { adminPassword: session.adminPassword });
    if (result.success) {
      members = result.data || [];
      if (Array.isArray(result.headers)) {
        displayHeaders = result.headers;
      } else if (members.length > 0) {
        displayHeaders = Object.keys(members[0]).filter(k => k !== "__rowIndex" && k !== "MatKhau");
      }
      filteredMembers = [...members];
    }
  } else if (session.role === "member") {
    const result = await apiCall("memberLogin", { cccd: session.cccd, password: session.password });
    if (result.success && result.data) {
      members = [result.data];
      if (members.length > 0) {
        displayHeaders = Object.keys(members[0]).filter(k => k !== "__rowIndex" && k !== "MatKhau");
      }
      filteredMembers = [...members];
    }
  }
}

async function reloadDataFromSheet(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById("reloadDataBtn");
  const originalText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Đang tải...";
  }
  try {
    await loadAllMembers();
    renderTable();
    updateFilterSummary();
  } catch (err) {
    alert("Lỗi tải lại dữ liệu: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

/* ---------- MAIN SCREEN ---------- */
function enterMainScreen() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("mainScreen").classList.remove("hidden");
  document.getElementById("whoAmI").textContent =
    session.role === "admin" ? "Đăng nhập với vai trò: Quản trị viên" : "Đăng nhập với vai trò: Đảng viên (CCCD: " + session.cccd + ")";
  const isAdmin = session.role === "admin";
  document.getElementById("addMemberBtn").style.display = isAdmin ? "inline-block" : "none";
  document.getElementById("exportBtn").style.display = isAdmin ? "inline-block" : "none";
  document.getElementById("sheetConfigBtn").style.display = isAdmin ? "inline-block" : "none";
  document.getElementById("advancedSearchBtn").style.display = isAdmin ? "inline-block" : "none";
  document.getElementById("searchBar").classList.toggle("hidden", !isAdmin);
  renderTable();
}

function doLogout() {
  session = { role: null, cccd: null, password: null, adminPassword: null };
  members = [];
  filteredMembers = [];
  advancedFilters = { ageDoi: null, ageDang: null };
  document.getElementById("mainScreen").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("memberPasswordField").classList.add("hidden");
  document.getElementById("memberPasswordInput").value = "";
  document.getElementById("memberCccdInput").value = "";
  document.getElementById("adminPasswordInput").value = "";
  document.getElementById("filterSummary").innerHTML = "";
  document.getElementById("clearFiltersBtn").style.display = "none";
}

/* ---------- RENDER TABLE ---------- */
function renderTable() {
  const thead = document.getElementById("tableHeader");
  const tbody = document.getElementById("tableBody");
  
  const headerRow = thead.querySelector("tr");
  headerRow.innerHTML = "";
  
  const displayCols = [
    "STT", "Họ và tên", "Ngày sinh", "Tuổi đời", 
    "Ngày vào đảng", "Tuổi đảng", "CCCD", "Số điện thoại", "Nơi thường trú"
  ];
  
  displayCols.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  
  // Áp dụng lọc
  let data = applyAllFilters();
  
  tbody.innerHTML = "";
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${displayCols.length}" style="text-align:center;padding:30px;color:var(--muted);">Không tìm thấy đảng viên nào</td></tr>`;
    document.getElementById("totalCount").textContent = "0";
    return;
  }
  
  data.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.onclick = () => openEditModal(m);
    const tuoiDoi = getAge(m["Ngày sinh"]);
    const tuoiDang = getPartyAge(m["Ngày vào đảng"]);
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${m["Họ và tên"] || ""}</td>
      <td>${m["Ngày sinh"] || ""}</td>
      <td>${tuoiDoi !== null ? tuoiDoi : ""}</td>
      <td>${m["Ngày vào đảng"] || ""}</td>
      <td>${tuoiDang !== null ? tuoiDang : ""}</td>
      <td>${m["CCCD"] || ""}</td>
      <td>${m["Số điện thoại"] || ""}</td>
      <td>${m["Nơi thường trú"] || ""}</td>
    `;
    tbody.appendChild(tr);
  });
  
  document.getElementById("totalCount").textContent = data.length;
}

/* ---------- FILTER SYSTEM ---------- */
function applyAllFilters() {
  let data = [...members];
  
  // Tìm kiếm cơ bản
  const searchText = (document.getElementById("searchInput")?.value || "").toLowerCase();
  if (searchText && session.role === "admin") {
    data = data.filter(m => {
      const name = String(m["Họ và tên"]).toLowerCase();
      const cccd = String(m["CCCD"]).toLowerCase();
      return name.includes(searchText) || cccd.includes(searchText);
    });
  }
  
  // Lọc theo tuổi đời
  if (advancedFilters.ageDoi) {
    const f = advancedFilters.ageDoi;
    data = data.filter(m => {
      const age = getAge(m["Ngày sinh"]);
      if (age === null) return false;
      switch (f.mode) {
        case 'exact': return age === f.value;
        case 'range': return age >= f.from && age <= f.to;
        case 'gte': return age >= f.value;
        case 'lte': return age <= f.value;
        default: return true;
      }
    });
  }
  
  // Lọc theo tuổi đảng
  if (advancedFilters.ageDang) {
    const f = advancedFilters.ageDang;
    data = data.filter(m => {
      const age = getPartyAge(m["Ngày vào đảng"]);
      if (age === null) return false;
      switch (f.mode) {
        case 'exact': return age === f.value;
        case 'range': return age >= f.from && age <= f.to;
        case 'gte': return age >= f.value;
        case 'lte': return age <= f.value;
        default: return true;
      }
    });
  }
  
  // Sắp xếp theo tên
  data = [...data].sort((a, b) =>
    getGivenName(a["Họ và tên"]).localeCompare(getGivenName(b["Họ và tên"]), "vi")
  );
  
  filteredMembers = data;
  return data;
}

function applyFilters() {
  renderTable();
  updateFilterSummary();
}

function updateFilterSummary() {
  const container = document.getElementById("filterSummary");
  const clearBtn = document.getElementById("clearFiltersBtn");
  let hasFilter = false;
  let html = "";
  
  // Hiển thị lọc tuổi đời
  if (advancedFilters.ageDoi) {
    const f = advancedFilters.ageDoi;
    let label = "";
    switch (f.mode) {
      case 'exact': label = `Tuổi đời = ${f.value}`; break;
      case 'range': label = `Tuổi đời ${f.from} - ${f.to}`; break;
      case 'gte': label = `Tuổi đời ≥ ${f.value}`; break;
      case 'lte': label = `Tuổi đời ≤ ${f.value}`; break;
    }
    html += `<span class="filter-badge">📅 ${label} <span class="remove" onclick="removeAgeFilter('doi')">✕</span></span>`;
    hasFilter = true;
  }
  
  // Hiển thị lọc tuổi đảng
  if (advancedFilters.ageDang) {
    const f = advancedFilters.ageDang;
    let label = "";
    switch (f.mode) {
      case 'exact': label = `Tuổi đảng = ${f.value}`; break;
      case 'range': label = `Tuổi đảng ${f.from} - ${f.to}`; break;
      case 'gte': label = `Tuổi đảng ≥ ${f.value}`; break;
      case 'lte': label = `Tuổi đảng ≤ ${f.value}`; break;
    }
    html += `<span class="filter-badge">🎯 ${label} <span class="remove" onclick="removeAgeFilter('dang')">✕</span></span>`;
    hasFilter = true;
  }
  
  container.innerHTML = html;
  clearBtn.style.display = hasFilter ? "inline-block" : "none";
}

function removeAgeFilter(type) {
  if (type === 'doi') {
    advancedFilters.ageDoi = null;
  } else if (type === 'dang') {
    advancedFilters.ageDang = null;
  }
  applyFilters();
}

function clearAllFilters() {
  advancedFilters = { ageDoi: null, ageDang: null };
  document.getElementById("searchInput").value = "";
  applyFilters();
  updateFilterSummary();
}

/* ---------- ADVANCED SEARCH / AGE FILTER ---------- */
function openAdvancedSearch() {
  if (session.role !== "admin") return;
  
  // Reset form với giá trị hiện tại
  const doi = advancedFilters.ageDoi;
  const dang = advancedFilters.ageDang;
  
  // Tuổi đời
  document.getElementById("ageDoiValue").value = doi ? doi.value || '' : '';
  document.getElementById("ageDoiFrom").value = doi ? doi.from || '' : '';
  document.getElementById("ageDoiTo").value = doi ? doi.to || '' : '';
  if (doi) {
    document.querySelector(`input[name="ageDoiMode"][value="${doi.mode}"]`).checked = true;
    document.getElementById("ageDoiRange").style.display = doi.mode === 'range' ? 'block' : 'none';
  } else {
    document.querySelector('input[name="ageDoiMode"][value="exact"]').checked = true;
    document.getElementById("ageDoiRange").style.display = 'none';
  }
  
  // Tuổi đảng
  document.getElementById("ageDangValue").value = dang ? dang.value || '' : '';
  document.getElementById("ageDangFrom").value = dang ? dang.from || '' : '';
  document.getElementById("ageDangTo").value = dang ? dang.to || '' : '';
  if (dang) {
    document.querySelector(`input[name="ageDangMode"][value="${dang.mode}"]`).checked = true;
    document.getElementById("ageDangRange").style.display = dang.mode === 'range' ? 'block' : 'none';
  } else {
    document.querySelector('input[name="ageDangMode"][value="exact"]').checked = true;
    document.getElementById("ageDangRange").style.display = 'none';
  }
  
  document.getElementById("advancedSearchMsg").innerHTML = "";
  document.getElementById("advancedSearchModalOverlay").classList.remove("hidden");
}

function closeAdvancedSearch() {
  document.getElementById("advancedSearchModalOverlay").classList.add("hidden");
}

function applyAdvancedSearch() {
  const msgEl = document.getElementById("advancedSearchMsg");
  
  // Xử lý tuổi đời
  const doiMode = document.querySelector('input[name="ageDoiMode"]:checked').value;
  const doiValue = parseInt(document.getElementById("ageDoiValue").value);
  const doiFrom = parseInt(document.getElementById("ageDoiFrom").value);
  const doiTo = parseInt(document.getElementById("ageDoiTo").value);
  
  let ageDoiFilter = null;
  if (doiMode === 'range') {
    if (isNaN(doiFrom) || isNaN(doiTo)) {
      showMsg("advancedSearchMsg", "Vui lòng nhập khoảng tuổi đời (Từ - Đến).", true);
      return;
    }
    if (doiFrom > doiTo) {
      showMsg("advancedSearchMsg", "Giá trị 'Từ' phải nhỏ hơn hoặc bằng 'Đến'.", true);
      return;
    }
    ageDoiFilter = { mode: 'range', from: doiFrom, to: doiTo };
  } else {
    if (isNaN(doiValue) || doiValue < 0) {
      showMsg("advancedSearchMsg", "Vui lòng nhập số tuổi đời hợp lệ.", true);
      return;
    }
    ageDoiFilter = { mode: doiMode, value: doiValue };
  }
  
  // Xử lý tuổi đảng
  const dangMode = document.querySelector('input[name="ageDangMode"]:checked').value;
  const dangValue = parseInt(document.getElementById("ageDangValue").value);
  const dangFrom = parseInt(document.getElementById("ageDangFrom").value);
  const dangTo = parseInt(document.getElementById("ageDangTo").value);
  
  let ageDangFilter = null;
  if (dangMode === 'range') {
    if (isNaN(dangFrom) || isNaN(dangTo)) {
      showMsg("advancedSearchMsg", "Vui lòng nhập khoảng tuổi đảng (Từ - Đến).", true);
      return;
    }
    if (dangFrom > dangTo) {
      showMsg("advancedSearchMsg", "Giá trị 'Từ' phải nhỏ hơn hoặc bằng 'Đến'.", true);
      return;
    }
    ageDangFilter = { mode: 'range', from: dangFrom, to: dangTo };
  } else {
    if (isNaN(dangValue) || dangValue < 0) {
      showMsg("advancedSearchMsg", "Vui lòng nhập số tuổi đảng hợp lệ.", true);
      return;
    }
    ageDangFilter = { mode: dangMode, value: dangValue };
  }
  
  // Lưu bộ lọc
  advancedFilters.ageDoi = ageDoiFilter;
  advancedFilters.ageDang = ageDangFilter;
  
  showMsg("advancedSearchMsg", "Đã áp dụng bộ lọc!", false);
  setTimeout(() => {
    closeAdvancedSearch();
    applyFilters();
  }, 500);
}

function clearAgeFilters() {
  advancedFilters = { ageDoi: null, ageDang: null };
  closeAdvancedSearch();
  applyFilters();
  updateFilterSummary();
}

// Hiển thị/ẩn input range khi chọn chế độ
document.addEventListener('DOMContentLoaded', function() {
  // Tuổi đời
  document.querySelectorAll('input[name="ageDoiMode"]').forEach(radio => {
    radio.addEventListener('change', function() {
      document.getElementById("ageDoiRange").style.display = this.value === 'range' ? 'block' : 'none';
    });
  });
  // Tuổi đảng
  document.querySelectorAll('input[name="ageDangMode"]').forEach(radio => {
    radio.addEventListener('change', function() {
      document.getElementById("ageDangRange").style.display = this.value === 'range' ? 'block' : 'none';
    });
  });
});

/* ---------- EDIT MODAL ---------- */
function openEditModal(record) {
  isAddMode = false;
  currentEdit = record;
  document.getElementById("editModalTitle").textContent = "Chi tiết đảng viên";
  document.getElementById("deleteBtn").classList.toggle("hidden", session.role !== "admin");
  buildEditForm(record);
  showMsg("editModalMsg", "");
  document.getElementById("editModalOverlay").classList.remove("hidden");
}

function openAddModal() {
  isAddMode = true;
  currentEdit = null;
  document.getElementById("editModalTitle").textContent = "Thêm đảng viên mới";
  document.getElementById("deleteBtn").classList.add("hidden");
  buildEditForm({});
  showMsg("editModalMsg", "");
  document.getElementById("editModalOverlay").classList.remove("hidden");
}

function closeEditModal() {
  document.getElementById("editModalOverlay").classList.add("hidden");
  currentEdit = null;
  isAddMode = false;
}

function buildEditForm(record) {
  const container = document.getElementById("editFormFields");
  container.innerHTML = "";
  
  const liveFields = displayHeaders.filter(f => f !== "STT" && f !== "MatKhau" && f !== "__rowIndex");
  const fields = liveFields.length > 0 ? liveFields.slice() : EDITABLE_FIELDS.slice();
  const isAdmin = session.role === "admin";
  
  if (isAdmin && !isAddMode) {
    fields.push("Mật khẩu");
  }
  
  fields.forEach(f => {
    const wrap = document.createElement("div");
    wrap.className = "field";
    
    let disabled = "";
    if (f === "CCCD" && session.role !== "admin" && !isAddMode) {
      disabled = "disabled";
    }
    
    let value = "";
    if (record && record[f] !== undefined && record[f] !== null) {
      value = record[f];
    } else if (f === "LLCT" && record && record["Lý luận chính trị"] !== undefined) {
      value = record["Lý luận chính trị"];
    }
    
    let inputHtml = '';
    if (f === "Mật khẩu" && isAdmin && !isAddMode) {
      const passValue = (record && record["MatKhau"]) || "";
      const inputId = 'pass_' + Math.random().toString(36).substr(2, 9);
      const cccd = record ? record["CCCD"] : "";
      inputHtml = `
        <div class="password-wrapper">
          <input type="password" id="${inputId}" data-key="Mật khẩu" value="${passValue}" 
                 placeholder="Nhập mật khẩu mới (để trống nếu không đổi)" />
          <button type="button" class="toggle-password" onclick="togglePassword('${inputId}', this)">👁️</button>
        </div>
        <div style="margin-top:6px;">
          <button class="btn btn-secondary" style="font-size:12px;padding:4px 12px;min-height:30px;" 
                  onclick="adminResetPassword('${cccd}')" type="button">
            🔄 Xóa mật khẩu (reset)
          </button>
          <span style="font-size:11px;color:var(--muted);margin-left:8px;">
            (Đảng viên sẽ chỉ cần CCCD để đăng nhập)
          </span>
        </div>
      `;
    } else {
      let displayValue = value || "";
      if (typeof displayValue === 'object' && displayValue instanceof Date) {
        displayValue = formatDate(displayValue);
      }
      let dataKey = f;
      if (f === "LLCT") {
        dataKey = "LLCT";
      }
      inputHtml = `
        <input type="text" data-key="${dataKey}" value="${displayValue}" ${disabled} />
      `;
    }
    
    wrap.innerHTML = `
      <label>${f}</label>
      ${inputHtml}
    `;
    container.appendChild(wrap);
  });
}

function collectFormRecord() {
  const inputs = document.querySelectorAll("#editFormFields input");
  const record = {};
  inputs.forEach(inp => { 
    const key = inp.dataset.key;
    if (key) {
      record[key] = inp.value;
    }
  });
  return record;
}

async function saveEditModal() {
  const record = collectFormRecord();
  showMsg("editModalMsg", "Đang lưu...", false);
  try {
    let result;
    
    if (session.role === "admin" && record["Mật khẩu"] !== undefined && !isAddMode) {
      const cccd = currentEdit ? currentEdit["CCCD"] : record["CCCD"];
      const newPassword = record["Mật khẩu"].trim();
      
      if (newPassword === "") {
        const resetResult = await apiCall("adminResetMemberPassword", {
          adminPassword: session.adminPassword,
          cccd: cccd
        });
        if (!resetResult.success) {
          showMsg("editModalMsg", resetResult.message || "Lỗi reset mật khẩu.", true);
          return;
        }
      } else if (newPassword.length < 6) {
        showMsg("editModalMsg", "Mật khẩu mới phải có ít nhất 6 ký tự.", true);
        return;
      } else {
        const passResult = await apiCall("adminChangeMemberPassword", {
          adminPassword: session.adminPassword,
          cccd: cccd,
          newPassword: newPassword
        });
        if (!passResult.success) {
          showMsg("editModalMsg", passResult.message || "Lỗi cập nhật mật khẩu.", true);
          return;
        }
      }
      delete record["Mật khẩu"];
    }
    
    if (isAddMode) {
      result = await apiCall("adminAddMember", { adminPassword: session.adminPassword, record });
    } else if (session.role === "admin") {
      result = await apiCall("adminUpdateMember", {
        adminPassword: session.adminPassword,
        rowIndex: currentEdit["__rowIndex"],
        record
      });
    } else {
      result = await apiCall("updateMember", {
        cccd: session.cccd,
        password: session.password,
        record
      });
    }

    if (result.success) {
      await loadAllMembers();
      renderTable();
      closeEditModal();
      alert("Lưu thành công!");
    } else {
      showMsg("editModalMsg", result.message || "Có lỗi xảy ra.", true);
    }
  } catch (err) {
    showMsg("editModalMsg", "Lỗi kết nối: " + err.message, true);
  }
}

async function deleteCurrentMember() {
  if (!currentEdit || session.role !== "admin") return;
  if (!confirm("Bạn có chắc muốn xoá đảng viên này?")) return;
  showMsg("editModalMsg", "Đang xoá...", false);
  try {
    const result = await apiCall("adminDeleteMember", {
      adminPassword: session.adminPassword,
      rowIndex: currentEdit["__rowIndex"]
    });
    if (result.success) {
      await loadAllMembers();
      renderTable();
      closeEditModal();
    } else {
      showMsg("editModalMsg", result.message || "Có lỗi xảy ra.", true);
    }
  } catch (err) {
    showMsg("editModalMsg", "Lỗi kết nối: " + err.message, true);
  }
}

async function adminResetPassword(cccd) {
  if (!confirm(`Bạn có chắc muốn xóa mật khẩu của đảng viên có CCCD: ${cccd}?`)) return;
  
  showMsg("editModalMsg", "Đang reset mật khẩu...", false);
  try {
    const result = await apiCall("adminResetMemberPassword", {
      adminPassword: session.adminPassword,
      cccd: cccd
    });
    if (result.success) {
      showMsg("editModalMsg", result.message || "Reset mật khẩu thành công!", false);
      await loadAllMembers();
      renderTable();
      if (currentEdit) {
        const updatedMember = members.find(m => m["CCCD"] === cccd);
        if (updatedMember) {
          currentEdit = updatedMember;
          buildEditForm(updatedMember);
        }
      }
    } else {
      showMsg("editModalMsg", result.message || "Có lỗi xảy ra.", true);
    }
  } catch (err) {
    showMsg("editModalMsg", "Lỗi kết nối: " + err.message, true);
  }
}

/* ---------- CHANGE PASSWORD ---------- */
function openChangePasswordModal() {
  document.getElementById("pwOld").value = "";
  document.getElementById("pwNew").value = "";
  document.getElementById("pwNewConfirm").value = "";
  showMsg("pwModalMsg", "");
  document.getElementById("pwModalOverlay").classList.remove("hidden");
}

function closePwModal() {
  document.getElementById("pwModalOverlay").classList.add("hidden");
}

async function submitChangePassword() {
  const oldPass = document.getElementById("pwOld").value;
  const newPass = document.getElementById("pwNew").value;
  const confirmPass = document.getElementById("pwNewConfirm").value;
  if (!newPass || newPass !== confirmPass) {
    showMsg("pwModalMsg", "Mật khẩu mới không khớp.", true);
    return;
  }
  if (newPass.length < 6) {
    showMsg("pwModalMsg", "Mật khẩu mới phải có ít nhất 6 ký tự.", true);
    return;
  }
  showMsg("pwModalMsg", "Đang xử lý...", false);
  try {
    let result;
    if (session.role === "admin") {
      result = await apiCall("changeAdminPassword", { oldPassword: oldPass, newPassword: newPass });
      if (result.success) session.adminPassword = newPass;
    } else {
      result = await apiCall("changeMemberPassword", { cccd: session.cccd, oldPassword: oldPass, newPassword: newPass });
      if (result.success) session.password = newPass;
    }
    if (result.success) {
      showMsg("pwModalMsg", result.message || "Đổi mật khẩu thành công.", false);
      setTimeout(closePwModal, 1200);
    } else {
      showMsg("pwModalMsg", result.message || "Có lỗi xảy ra.", true);
    }
  } catch (err) {
    showMsg("pwModalMsg", "Lỗi kết nối: " + err.message, true);
  }
}

/* ---------- SHEET CONFIG ---------- */
async function openSheetConfigModal() {
  if (session.role !== "admin") return;
  
  showMsg("sheetConfigMsg", "Đang tải cấu hình...", false);
  try {
    const result = await apiCall("getSheetConfig", { adminPassword: session.adminPassword });
    if (result.success) {
      document.getElementById("sheetTitleInput").value = result.config.title || "DANH SÁCH ĐẢNG VIÊN CHI BỘ";
      renderColumnList(result.config.headers || []);
      document.getElementById("sheetConfigMsg").innerHTML = "";
      document.getElementById("sheetConfigModalOverlay").classList.remove("hidden");
    } else {
      showMsg("sheetConfigMsg", result.message || "Lỗi tải cấu hình.", true);
    }
  } catch (err) {
    showMsg("sheetConfigMsg", "Lỗi kết nối: " + err.message, true);
  }
}

function closeSheetConfigModal() {
  document.getElementById("sheetConfigModalOverlay").classList.add("hidden");
}

function renderColumnList(headers) {
  const container = document.getElementById("columnList");
  container.innerHTML = "";
  
  headers.forEach((col, index) => {
    const div = document.createElement("div");
    div.className = "sheet-config-item";
    div.draggable = true;
    div.dataset.index = index;
    
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Kéo để sắp xếp lại";
    
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "col-name-input";
    nameInput.value = col;
    nameInput.placeholder = "Tên cột";
    nameInput.dataset.original = col;
    
    const removeBtn = document.createElement("span");
    removeBtn.className = "col-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Xóa cột";
    if (REQUIRED_FIELDS.includes(col)) {
      removeBtn.style.opacity = "0.3";
      removeBtn.style.cursor = "not-allowed";
    } else {
      removeBtn.onclick = function(e) {
        e.stopPropagation();
        removeColumn(index);
      };
    }
    
    div.appendChild(handle);
    div.appendChild(nameInput);
    div.appendChild(removeBtn);
    
    div.addEventListener("dragstart", function(e) {
      dragItem = this;
      this.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/html", this.innerHTML);
    });
    
    div.addEventListener("dragend", function() {
      this.classList.remove("dragging");
      dragItem = null;
      dragOverItem = null;
      document.querySelectorAll(".sheet-config-item").forEach(el => {
        el.style.borderTop = "none";
        el.style.borderBottom = "none";
      });
    });
    
    div.addEventListener("dragover", function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      
      document.querySelectorAll(".sheet-config-item").forEach(el => {
        el.style.borderTop = "none";
        el.style.borderBottom = "none";
      });
      
      const rect = this.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < rect.height / 2) {
        this.style.borderTop = "2px solid var(--primary)";
        this.style.borderBottom = "none";
      } else {
        this.style.borderTop = "none";
        this.style.borderBottom = "2px solid var(--primary)";
      }
      
      dragOverItem = this;
    });
    
    div.addEventListener("dragleave", function(e) {
      this.style.borderTop = "none";
      this.style.borderBottom = "none";
    });
    
    div.addEventListener("drop", function(e) {
      e.preventDefault();
      this.style.borderTop = "none";
      this.style.borderBottom = "none";
      
      if (dragItem && dragItem !== this) {
        const items = Array.from(container.children);
        const fromIndex = items.indexOf(dragItem);
        const toIndex = items.indexOf(this);
        
        if (fromIndex < toIndex) {
          this.parentNode.insertBefore(dragItem, this.nextSibling);
        } else {
          this.parentNode.insertBefore(dragItem, this);
        }
        updateColumnIndices();
      }
    });
    
    container.appendChild(div);
  });
}

function updateColumnIndices() {
  const items = document.querySelectorAll(".sheet-config-item");
  items.forEach((el, idx) => {
    el.dataset.index = idx;
  });
}

function addNewColumn() {
  const input = document.getElementById("newColumnName");
  const name = input.value.trim();
  if (!name) {
    showMsg("sheetConfigMsg", "Vui lòng nhập tên cột.", true);
    return;
  }
  if (REQUIRED_FIELDS.includes(name)) {
    showMsg("sheetConfigMsg", `"${name}" là cột bắt buộc, không thể thêm lại.`, true);
    return;
  }
  
  const existing = document.querySelectorAll(".col-name-input");
  for (let el of existing) {
    if (el.value.trim() === name) {
      showMsg("sheetConfigMsg", `Cột "${name}" đã tồn tại.`, true);
      return;
    }
  }
  
  const container = document.getElementById("columnList");
  const div = document.createElement("div");
  div.className = "sheet-config-item";
  div.draggable = true;
  div.dataset.index = container.children.length;
  
  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "⠿";
  
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "col-name-input";
  nameInput.value = name;
  nameInput.dataset.original = name;
  
  const removeBtn = document.createElement("span");
  removeBtn.className = "col-remove";
  removeBtn.textContent = "✕";
  removeBtn.onclick = function(e) {
    e.stopPropagation();
    const idx = parseInt(div.dataset.index);
    removeColumn(idx);
  };
  
  div.appendChild(handle);
  div.appendChild(nameInput);
  div.appendChild(removeBtn);
  
  div.addEventListener("dragstart", function(e) {
    dragItem = this;
    this.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/html", this.innerHTML);
  });
  
  div.addEventListener("dragend", function() {
    this.classList.remove("dragging");
    dragItem = null;
    dragOverItem = null;
    document.querySelectorAll(".sheet-config-item").forEach(el => {
      el.style.borderTop = "none";
      el.style.borderBottom = "none";
    });
  });
  
  div.addEventListener("dragover", function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".sheet-config-item").forEach(el => {
      el.style.borderTop = "none";
      el.style.borderBottom = "none";
    });
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height / 2) {
      this.style.borderTop = "2px solid var(--primary)";
    } else {
      this.style.borderBottom = "2px solid var(--primary)";
    }
    dragOverItem = this;
  });
  
  div.addEventListener("dragleave", function() {
    this.style.borderTop = "none";
    this.style.borderBottom = "none";
  });
  
  div.addEventListener("drop", function(e) {
    e.preventDefault();
    this.style.borderTop = "none";
    this.style.borderBottom = "none";
    if (dragItem && dragItem !== this) {
      const items = Array.from(container.children);
      const fromIndex = items.indexOf(dragItem);
      const toIndex = items.indexOf(this);
      if (fromIndex < toIndex) {
        this.parentNode.insertBefore(dragItem, this.nextSibling);
      } else {
        this.parentNode.insertBefore(dragItem, this);
      }
      updateColumnIndices();
    }
  });
  
  container.appendChild(div);
  input.value = "";
  showMsg("sheetConfigMsg", `Đã thêm cột "${name}"`, false);
}

function removeColumn(index) {
  const items = document.querySelectorAll(".sheet-config-item");
  const target = items[index];
  const nameInput = target.querySelector(".col-name-input");
  const colName = nameInput.value.trim();
  
  if (REQUIRED_FIELDS.includes(colName)) {
    showMsg("sheetConfigMsg", `Không thể xóa cột bắt buộc: "${colName}"`, true);
    return;
  }
  
  if (!confirm(`Xóa cột "${colName}"?`)) return;
  
  target.remove();
  updateColumnIndices();
  showMsg("sheetConfigMsg", `Đã xóa cột "${colName}"`, false);
}

async function saveSheetConfig() {
  const title = document.getElementById("sheetTitleInput").value.trim() || "DANH SÁCH ĐẢNG VIÊN CHI BỘ";
  
  const headers = [];
  const originals = [];
  document.querySelectorAll(".col-name-input").forEach(input => {
    const val = input.value.trim();
    if (val) {
      headers.push(val);
      originals.push(input.dataset.original || val);
    }
  });
  
  let hasError = false;
  REQUIRED_FIELDS.forEach(req => {
    if (!headers.includes(req)) {
      showMsg("sheetConfigMsg", `Thiếu cột bắt buộc: "${req}"`, true);
      hasError = true;
    }
  });
  if (hasError) return;
  
  showMsg("sheetConfigMsg", "Đang lưu...", false);
  try {
    const result = await apiCall("updateSheetConfig", {
      adminPassword: session.adminPassword,
      config: { title, headers, originals }
    });
    
    if (result.success) {
      showMsg("sheetConfigMsg", result.message || "Lưu thành công! Dữ liệu đã được giữ nguyên.", false);
      try {
        await loadAllMembers();
        renderTable();
      } catch (refreshErr) {
        console.error("Lỗi làm mới dữ liệu sau khi lưu cấu hình sheet:", refreshErr);
      }
      setTimeout(() => {
        closeSheetConfigModal();
      }, 1200);
    } else {
      showMsg("sheetConfigMsg", result.message || "Có lỗi xảy ra.", true);
    }
  } catch (err) {
    showMsg("sheetConfigMsg", "Lỗi kết nối: " + err.message, true);
  }
}

/* ---------- EXPORT EXCEL ---------- */
function openExportModal() {
  if (session.role !== "admin") return;
  const container = document.getElementById("exportColumns");
  container.innerHTML = "";
  
  const liveCols = displayHeaders.filter(f => f !== "MatKhau" && f !== "__rowIndex");
  const displayCols = liveCols.length > 0 ? liveCols : ["STT", "Họ và tên", "Ngày sinh", "Ngày vào đảng", "Ngày chính thức",
    "Dân tộc", "Tôn giáo", "CCCD", "Thẻ đảng viên", "Học vấn (Vd: 10/10, 12/12...)",
    "Chuyên môn", "LLCT", "Số điện thoại", "Chi bộ cũ",
    "Miễn sinh hoạt", "Nơi thường trú"];
  
  displayCols.forEach(col => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" class="export-col-check" value="${col}" checked /> ${col}`;
    container.appendChild(label);
  });
  
  document.getElementById("exportAllColumns").checked = true;
  document.getElementById("exportModalMsg").innerHTML = "";
  document.getElementById("exportModalOverlay").classList.remove("hidden");
}

function closeExportModal() {
  document.getElementById("exportModalOverlay").classList.add("hidden");
}

function toggleAllExportColumns() {
  const checked = document.getElementById("exportAllColumns").checked;
  document.querySelectorAll(".export-col-check").forEach(cb => cb.checked = checked);
}

function doExportExcel() {
  const selectedCols = [];
  document.querySelectorAll(".export-col-check:checked").forEach(cb => {
    selectedCols.push(cb.value);
  });
  
  if (selectedCols.length === 0) {
    document.getElementById("exportModalMsg").innerHTML = '<div class="msg error">Vui lòng chọn ít nhất 1 cột để xuất.</div>';
    return;
  }
  
  let data = [...filteredMembers];
  if (!data || data.length === 0) {
    document.getElementById("exportModalMsg").innerHTML = '<div class="msg error">Không có dữ liệu để xuất.</div>';
    return;
  }
  
  const sortField = document.getElementById("exportSortField").value;
  const sortOrder = document.getElementById("exportSortOrder").value;
  
  data.sort((a, b) => {
    let valA, valB;
    switch (sortField) {
      case "ho_ten":
        valA = getGivenName(a["Họ và tên"]);
        valB = getGivenName(b["Họ và tên"]);
        if (valA === valB) {
          valA = String(a["Họ và tên"] || "").toLowerCase();
          valB = String(b["Họ và tên"] || "").toLowerCase();
        }
        return sortOrder === "asc" ? valA.localeCompare(valB, "vi") : valB.localeCompare(valA, "vi");
      default:
        return 0;
    }
  });
  
  const excelData = data.map((m, idx) => {
    const row = { "STT": idx + 1 };
    selectedCols.forEach(col => {
      if (col !== "STT") {
        let val = m[col] || "";
        if (typeof val === 'object' && val instanceof Date) {
          val = formatDate(val);
        }
        row[col] = val;
      }
    });
    return row;
  });
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(wb, ws, "DanhSach");
  
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Danh_sach_dang_vien_${new Date().toISOString().slice(0,10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  
  document.getElementById("exportModalMsg").innerHTML = '<div class="msg success">✅ Xuất file thành công!</div>';
  setTimeout(closeExportModal, 1500);
}

/* ---------- KHỞI TẠO TỰ ĐỘNG ---------- */
document.addEventListener('DOMContentLoaded', function() {
  autoInitApp();
});

async function autoInitApp() {
  try {
    const result = await apiCall('initApp', {});
    if (result.success) {
      console.log('✅ Khởi tạo ứng dụng thành công:', result.message);
      if (result.count !== undefined) {
        console.log(`📊 Đã đồng bộ ${result.count} đảng viên`);
      }
    } else {
      console.warn('⚠️ Lỗi khởi tạo:', result.message);
    }
  } catch (err) {
    console.error('❌ Lỗi kết nối khi khởi tạo:', err.message);
  }
}