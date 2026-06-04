/**
 * 着物在庫管理・棚卸システム - メイン制御スクリプト (app.js)
 * 
 * アプリケーションのUI操作、タブ切り替え、カメラ(QRコードスキャナー)制御、
 * 音響・視覚フィードバック、QRコード生成、印刷処理、在庫一覧のフィルタリングなどを管理します。
 */

import {
  fetchAllItems,
  fetchItemByCode,
  saveNewItem,
  performAudit,
  updateItemStatus
} from "./api.js";

// ==========================================
// 1. グローバル状態管理
// ==========================================
let html5QrCode = null; // Html5Qrcodeインスタンス
let isScanning = false; // スキャン実行中フラグ
let currentFacingMode = "environment"; // カメラ向き ("environment": 背面, "user": 前面)
let currentAuditFilter = "all"; // 在庫一覧の棚卸状況フィルター ("all", "pending", "completed")
let todayScanHistory = []; // 本日のスキャン履歴 (メモリ上)

// ==========================================
// 2. DOM要素の取得
// ==========================================
// ナビゲーション・画面切り替え
const navScan = document.getElementById("nav-scan");
const navList = document.getElementById("nav-list");
const navRegister = document.getElementById("nav-register");
const viewScan = document.getElementById("view-scan");
const viewList = document.getElementById("view-list");
const viewRegister = document.getElementById("view-register");

// スキャナー関連
const btnCameraControl = document.getElementById("btn-camera-control");
const btnToggleCameraFacing = document.getElementById("btn-toggle-camera-facing");
const scannerPlaceholder = document.getElementById("scanner-placeholder");
const scanTargetBox = document.getElementById("scan-target-box");
const scanFlash = document.getElementById("scan-flash");
const scanHistoryList = document.getElementById("scan-history-list");
const scanCountBadge = document.getElementById("scan-count-badge");

// モーダル関連
const modalScanResult = document.getElementById("modal-scan-result");
const modalContent = document.getElementById("modal-content");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnModalConfirm = document.getElementById("btn-modal-confirm");
const modalCode = document.getElementById("modal-code");
const modalName = document.getElementById("modal-name");
const modalSpecType = document.getElementById("modal-spec-type");
const modalPriceSale = document.getElementById("modal-price-sale");
const modalPriceRent = document.getElementById("modal-price-rent");
const modalSize = document.getElementById("modal-size");
const modalStatusSelect = document.getElementById("modal-status-select");
const modalTimestamp = document.getElementById("modal-timestamp");
const modalRowPriceSale = document.getElementById("modal-row-price-sale");
const modalRowPriceRent = document.getElementById("modal-row-price-rent");
const modalRowSize = document.getElementById("modal-row-size");

// 在庫一覧関連
const inventoryList = document.getElementById("inventory-list");
const filterSearch = document.getElementById("filter-search");
const filterType = document.getElementById("filter-type");
const filterStatus = document.getElementById("filter-status");
const btnFilterAll = document.getElementById("btn-filter-audit-all");
const btnFilterPending = document.getElementById("btn-filter-audit-pending");
const btnFilterCompleted = document.getElementById("btn-filter-audit-completed");
const summaryTotal = document.getElementById("summary-total");
const summaryCompleted = document.getElementById("summary-completed");
const summaryPending = document.getElementById("summary-pending");

// 新規登録関連
const formRegisterItem = document.getElementById("form-register-item");
const regCode = document.getElementById("reg-code");
const regName = document.getElementById("reg-name");
const regType = document.getElementById("reg-type");
const regTailor = document.getElementById("reg-tailor");
const regPriceSale = document.getElementById("reg-price-sale");
const regPriceRent = document.getElementById("reg-price-rent");
const regSizeMitake = document.getElementById("reg-size-mitake");
const regSizeYuki = document.getElementById("reg-size-yuki");
const regStatus = document.getElementById("reg-status");
const btnGenCode = document.getElementById("btn-gen-code");

// QRコード・印刷結果関連
const qrResultArea = document.getElementById("qr-result-area");
const qrcodeContainer = document.getElementById("qrcode-container");
const qrCodeText = document.getElementById("qr-code-text");
const qrNameText = document.getElementById("qr-name-text");
const qrTypeText = document.getElementById("qr-type-text");
const qrTailorText = document.getElementById("qr-tailor-text");
const qrSizeText = document.getElementById("qr-size-text");
const btnPrintTag = document.getElementById("btn-print-tag");
const btnCloseQrResult = document.getElementById("btn-close-qr-result");

// ==========================================
// 3. ユーティリティ関数
// ==========================================

/**
 * Web Audio APIを利用して、スキャン成功時の電子音（ピピッ）を動的生成して鳴らします。
 * 外部音源ファイルが不要なため、オフラインやProject IDX上でも確実に動作します。
 */
function playBeepSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 1番目の短い高音
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(1000, audioCtx.currentTime); // 1000Hz
    gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);     // 音量
    
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.08); // 0.08秒鳴らす

    // 2番目のさらに高い音（連続してピピッと聞こえるように）
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1300, audioCtx.currentTime); // 1300Hz
      gain2.gain.setValueAtTime(0.08, audioCtx.currentTime);
      
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.08);
      
      setTimeout(() => audioCtx.close(), 200);
    }, 90);

  } catch (error) {
    console.error("ビープ音の再生に失敗しました:", error);
  }
}

/**
 * 画面を一瞬緑色に光らせる視覚的フィードバック（フラッシュ効果）を実行します。
 */
function triggerScreenFlash() {
  scanFlash.classList.add("flash-active");
  // アニメーション時間 (300ms) 後にクラスを外す
  setTimeout(() => {
    scanFlash.classList.remove("flash-active");
  }, 300);
}

/**
 * ISOタイムスタンプを人間が見やすい日本のフォーマットに変換します。
 * @param {string} isoString ISO日時文字列
 * @returns {string} フォーマットされた日付
 */
function formatDate(isoString) {
  if (!isoString) return "未完了";
  
  const date = new Date(isoString);
  const now = new Date();
  
  // 今日の場合は時間だけを分かりやすく表示
  if (date.toDateString() === now.toDateString()) {
    return `今日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hr = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  
  return `${y}/${m}/${d} ${hr}:${min}`;
}

/**
 * 通貨（価格）をフォーマットします。
 * @param {number} amount 金額
 * @returns {string} 伝票表記 (¥3,000)
 */
function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return "ー";
  return `¥${Number(amount).toLocaleString()}`;
}

// ==========================================
// 4. SPA 画面タブ切り替えロジック
// ==========================================
function switchView(targetView) {
  // すべての画面を非表示
  viewScan.classList.add("hidden");
  viewList.classList.add("hidden");
  viewRegister.classList.add("hidden");

  // ナビボタンのハイライトをリセット
  const navBtns = [navScan, navList, navRegister];
  navBtns.forEach(btn => {
    btn.classList.remove("text-kimono-gold");
    btn.classList.add("text-zinc-400", "hover:text-white");
  });

  // アクティブな画面を表示し、ボタンをハイライト
  if (targetView === "scan") {
    viewScan.classList.remove("hidden");
    navScan.classList.add("text-kimono-gold");
    navScan.classList.remove("text-zinc-400");
  } else if (targetView === "list") {
    viewList.classList.remove("hidden");
    navList.classList.add("text-kimono-gold");
    navList.classList.remove("text-zinc-400");
    renderInventoryList(); // 一覧を開くたびに再描画
  } else if (targetView === "register") {
    viewRegister.classList.remove("hidden");
    navRegister.classList.add("text-kimono-gold");
    navRegister.classList.remove("text-zinc-400");
  }

  // スキャン画面以外に移動したら、バッテリー維持のためにカメラを停止する
  if (targetView !== "scan" && isScanning) {
    stopCamera();
  }
}

// ナビゲーションのイベントリスナー登録
navScan.addEventListener("click", () => switchView("scan"));
navList.addEventListener("click", () => switchView("list"));
navRegister.addEventListener("click", () => switchView("register"));

// ==========================================
// 5. QRコードスキャナー制御 (html5-qrcode)
// ==========================================

/**
 * カメラの起動処理
 */
async function startCamera() {
  try {
    // スキャナーインスタンスの生成 (すでに存在しない場合のみ)
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }

    // UIの切り替え
    scannerPlaceholder.classList.add("hidden");
    scanTargetBox.classList.remove("hidden");

    // カメラの起動設定
    const config = {
      fps: 10,                 // 1秒間のフレーム数 (モバイル端末への負荷を低減)
      qrbox: (width, height) => {
        // ファインダーのサイズ計算
        const size = Math.min(width, height) * 0.7;
        return { width: size, height: size };
      },
      aspectRatio: 1.0         // 正方形
    };

    // カメラの開始
    await html5QrCode.start(
      { facingMode: currentFacingMode }, // 背面または前面カメラ
      config,
      onScanSuccess,                     // スキャン成功コールバック
      onScanError                        // スキャンエラー（毎フレーム解析失敗時）コールバック
    );

    isScanning = true;
    btnCameraControl.innerHTML = `<i data-lucide="square" class="w-5 h-5"></i><span>カメラを停止する</span>`;
    btnCameraControl.classList.remove("bg-kimono-red", "hover:bg-red-800");
    btnCameraControl.classList.add("bg-zinc-700", "hover:bg-zinc-800");
    lucide.createIcons(); // アイコン再レンダリング

  } catch (error) {
    console.error("カメラの起動に失敗しました:", error);
    alert("カメラの起動に失敗しました。カメラ使用権限を許可し、HTTPS接続またはProject IDXプレビュー上で起動しているか確認してください。");
    stopCamera();
  }
}

/**
 * カメラの停止処理
 */
async function stopCamera() {
  if (html5QrCode && isScanning) {
    try {
      await html5QrCode.stop();
    } catch (err) {
      console.error("カメラ停止時のエラー:", err);
    }
  }
  isScanning = false;
  scannerPlaceholder.classList.remove("hidden");
  scanTargetBox.classList.add("hidden");
  
  btnCameraControl.innerHTML = `<i data-lucide="play" class="w-5 h-5"></i><span>カメラを起動する</span>`;
  btnCameraControl.classList.remove("bg-zinc-700", "hover:bg-zinc-800");
  btnCameraControl.classList.add("bg-kimono-red", "hover:bg-red-800");
  lucide.createIcons(); // アイコン再レンダリング
}

/**
 * カメラ切り替え (前面 / 背面)
 */
async function toggleCameraFacing() {
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  if (isScanning) {
    await stopCamera();
    await startCamera();
  }
}

// カメラボタンのリスナー
btnCameraControl.addEventListener("click", () => {
  if (isScanning) {
    stopCamera();
  } else {
    startCamera();
  }
});
btnToggleCameraFacing.addEventListener("click", toggleCameraFacing);

// ==========================================
// 6. スキャン成功・検出時の処理
// ==========================================

/**
 * QRコードの読み取りに成功した際の処理
 * @param {string} decodedText QRコードの内容
 */
async function onScanSuccess(decodedText) {
  // 即座に音と画面フラッシュを実行してユーザーにフィードバック
  playBeepSound();
  triggerScreenFlash();

  console.log("QRコードスキャン成功:", decodedText);

  // 連続読み取りによる誤動作防止のため一時的にカメラを停止
  await stopCamera();

  try {
    // データベース (LocalStorage) から該当着物を検索
    const kimono = await fetchItemByCode(decodedText);

    if (kimono) {
      // 棚卸し処理の実行 (最終棚卸確認日を更新)
      const updatedKimono = await performAudit(kimono.code);
      
      // 本日のスキャン履歴に登録
      addToHistory(updatedKimono);
      
      // ポップアップ詳細モーダルの表示
      openScanResultModal(updatedKimono);
    } else {
      // 未登録のQRコードだった場合
      const wantRegister = confirm(`未登録の商品番号「${decodedText}」が読み取られました。\nこの番号で新規登録を行いますか？`);
      if (wantRegister) {
        // 新規登録画面へ切り替えて、商品番号を自動セット
        switchView("register");
        regCode.value = decodedText;
        regName.focus();
      } else {
        // 再度カメラを起動してスキャンを継続
        await startCamera();
      }
    }
  } catch (error) {
    console.error("スキャン後の処理中にエラーが発生しました:", error);
    alert(error.message || "エラーが発生しました");
    await startCamera();
  }
}

/**
 * 読み取りフレームごとのエラー (通常は無視します)
 */
function onScanError(errorMessage) {
  // 大量のログが出るのを防ぐため通常は出力しません
}

// ==========================================
// 7. モーダル（スキャン結果・確認）の制御
// ==========================================
let activeModalKimonoCode = null; // 現在モーダルで開いている着物の商品番号

function openScanResultModal(kimono) {
  activeModalKimonoCode = kimono.code;
  
  modalCode.textContent = kimono.code;
  modalName.textContent = kimono.name;
  modalSpecType.textContent = `${kimono.type} / ${kimono.tailor}`;
  
  // 価格表示の切り替え
  if (kimono.priceSale) {
    modalRowPriceSale.classList.remove("hidden");
    modalPriceSale.textContent = formatCurrency(kimono.priceSale);
  } else {
    modalRowPriceSale.classList.add("hidden");
  }

  if (kimono.priceRent) {
    modalRowPriceRent.classList.remove("hidden");
    modalPriceRent.textContent = formatCurrency(kimono.priceRent);
  } else {
    modalRowPriceRent.classList.add("hidden");
  }

  // サイズ表示の切り替え
  if (kimono.sizeMitake || kimono.sizeYuki) {
    modalRowSize.classList.remove("hidden");
    modalSize.textContent = `身丈: ${kimono.sizeMitake || "ー"}cm / 裄丈: ${kimono.sizeYuki || "ー"}cm`;
  } else {
    modalRowSize.classList.add("hidden");
  }

  // ステータスセレクトボックスのセット
  modalStatusSelect.value = kimono.status;
  
  // 最終棚卸し日のセット
  modalTimestamp.textContent = formatDate(kimono.lastAuditDate);

  // モーダルをふわっと表示する
  modalScanResult.classList.remove("hidden");
  setTimeout(() => {
    modalScanResult.classList.remove("opacity-0");
    modalContent.classList.remove("scale-95");
    modalContent.classList.add("scale-100");
  }, 10);
}

function closeModal() {
  modalScanResult.classList.add("opacity-0");
  modalContent.classList.remove("scale-100");
  modalContent.classList.add("scale-95");
  setTimeout(() => {
    modalScanResult.classList.add("hidden");
    activeModalKimonoCode = null;
    
    // スキャン画面に戻る場合、カメラを自動再開
    if (!viewScan.classList.contains("hidden") && !isScanning) {
      startCamera();
    }
  }, 300);
}

// モーダルの在庫ステータス変更イベント
modalStatusSelect.addEventListener("change", async (e) => {
  if (!activeModalKimonoCode) return;
  const newStatus = e.target.value;
  try {
    await updateItemStatus(activeModalKimonoCode, newStatus);
    console.log(`ステータスを更新しました: ${activeModalKimonoCode} -> ${newStatus}`);
  } catch (error) {
    alert("ステータスの更新に失敗しました: " + error.message);
  }
});

btnCloseModal.addEventListener("click", closeModal);
btnModalConfirm.addEventListener("click", closeModal);

// ==========================================
// 8. スキャン履歴管理
// ==========================================
function addToHistory(kimono) {
  // すでに履歴にある場合は削除して先頭に再配置
  todayScanHistory = todayScanHistory.filter(x => x.code !== kimono.code);
  todayScanHistory.unshift(kimono);

  // 履歴バッジ数の更新
  scanCountBadge.textContent = `${todayScanHistory.length}件`;

  // リストの描画
  if (todayScanHistory.length === 0) {
    scanHistoryList.innerHTML = `<p class="text-xs text-center text-kimono-muted py-4">スキャンした履歴がここに表示されます</p>`;
    return;
  }

  scanHistoryList.innerHTML = todayScanHistory.map(item => `
    <div class="flex items-center justify-between py-2 text-xs border-b border-zinc-50 last:border-0 hover:bg-zinc-50 px-1 rounded transition-colors" onclick="window.showHistoryDetail('${item.code}')" style="cursor: pointer;">
      <div class="flex flex-col">
        <span class="font-mono font-bold text-kimono-red">${item.code}</span>
        <span class="font-medium text-zinc-700 truncate max-w-[180px]">${item.name}</span>
      </div>
      <div class="text-right">
        <span class="inline-block px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-800 font-semibold mb-0.5">棚卸完了</span>
        <p class="text-[9px] text-zinc-400">${formatDate(item.lastAuditDate)}</p>
      </div>
    </div>
  `).join("");
}

// グローバルスコープに履歴詳細を開く関数を露出
window.showHistoryDetail = async function(code) {
  const item = await fetchItemByCode(code);
  if (item) {
    openScanResultModal(item);
  }
};

// ==========================================
// 9. 在庫一覧・検索の描画とフィルタリング
// ==========================================

/**
 * 絞り込み条件に沿って在庫リストを描画
 */
async function renderInventoryList() {
  try {
    const allItems = await fetchAllItems();

    // フィルターの取得
    const searchVal = filterSearch.value.trim().toLowerCase();
    const typeVal = filterType.value;
    const statusVal = filterStatus.value;

    // フィルタリング処理
    const filtered = allItems.filter(item => {
      // 1. キーワード検索 (商品番号 または 商品名)
      const matchKeyword = !searchVal || 
        item.code.toLowerCase().includes(searchVal) || 
        item.name.toLowerCase().includes(searchVal);
      
      // 2. 種類フィルター
      const matchType = !typeVal || item.type === typeVal;

      // 3. ステータスフィルター
      const matchStatus = !statusVal || item.status === statusVal;

      // 4. 棚卸し状況フィルター (完了 / 未完了)
      let matchAudit = true;
      const isCompleted = !!item.lastAuditDate; // 空文字でなければ完了
      if (currentAuditFilter === "pending") {
        matchAudit = !isCompleted;
      } else if (currentAuditFilter === "completed") {
        matchAudit = isCompleted;
      }

      return matchKeyword && matchType && matchStatus && matchAudit;
    });

    // 簡易サマリーの計算
    const total = allItems.length;
    const completed = allItems.filter(x => !!x.lastAuditDate).length;
    const pending = total - completed;

    summaryTotal.textContent = total;
    summaryCompleted.textContent = completed;
    summaryPending.textContent = pending;

    // リストの描画
    if (filtered.length === 0) {
      inventoryList.innerHTML = `
        <div class="bg-white rounded-2xl p-8 text-center border border-kimono-gold/10">
          <i data-lucide="info" class="w-8 h-8 mx-auto text-kimono-muted mb-2"></i>
          <p class="text-sm font-medium text-kimono-muted">該当する着物が見つかりません</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    // 各アイテムをカードとして出力
    inventoryList.innerHTML = filtered.map(item => {
      const isCompleted = !!item.lastAuditDate;
      
      // 棚卸しステータスに応じたデザイン設定
      // 未完了＝紅梅色/赤枠, 完了＝若竹色/緑枠
      const borderClass = isCompleted ? "border-l-4 border-l-emerald-600 border-emerald-100" : "border-l-4 border-l-kimono-red border-red-100";
      const statusBadge = isCompleted 
        ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5"><i data-lucide="check" class="w-3 h-3"></i>完了済</span>`
        : `<span class="bg-red-50 text-kimono-red text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5"><i data-lucide="alert-circle" class="w-3 h-3"></i>未棚卸</span>`;

      return `
        <div class="bg-white rounded-xl shadow-xs border ${borderClass} p-3.5 space-y-2.5 transition-all">
          <div class="flex justify-between items-start">
            <div class="space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold text-zinc-500">${item.code}</span>
                ${statusBadge}
              </div>
              <h3 class="font-serif font-bold text-sm text-kimono-charcoal leading-snug">${item.name}</h3>
            </div>
            <!-- クイック棚卸し実行ボタン -->
            ${!isCompleted ? `
              <button onclick="window.quickAudit('${item.code}')" class="bg-kimono-cream text-kimono-red border border-kimono-red/30 hover:bg-kimono-red hover:text-white transition-colors text-[10px] px-2 py-1 rounded-md font-semibold flex items-center gap-0.5">
                <i data-lucide="check-square" class="w-3 h-3"></i>実在確認
              </button>
            ` : ""}
          </div>

          <div class="grid grid-cols-2 text-[11px] text-zinc-500 gap-y-1 bg-kimono-cream/50 p-2 rounded-lg border border-kimono-gold/5">
            <div><span class="font-semibold text-zinc-700">種類:</span> ${item.type} (${item.tailor})</div>
            <div><span class="font-semibold text-zinc-700">状態:</span> 
              <select onchange="window.quickStatusChange('${item.code}', this.value)" class="bg-transparent text-[11px] focus:outline-none font-medium text-zinc-700 border-b border-dotted border-zinc-400">
                <option value="保管中" ${item.status === "保管中" ? "selected" : ""}>保管中</option>
                <option value="レンタル中" ${item.status === "レンタル中" ? "selected" : ""}>レンタル中</option>
                <option value="クリーニング中" ${item.status === "クリーニング中" ? "selected" : ""}>クリーニング中</option>
                <option value="売上済" ${item.status === "売上済" ? "selected" : ""}>売上済</option>
              </select>
            </div>
            <div class="col-span-2 flex justify-between">
              <span><span class="font-semibold text-zinc-700">販売:</span> ${formatCurrency(item.priceSale)}</span>
              <span><span class="font-semibold text-zinc-700">レンタル:</span> ${formatCurrency(item.priceRent)}</span>
            </div>
            ${item.sizeMitake || item.sizeYuki ? `
              <div class="col-span-2 border-t border-dashed border-zinc-200/60 pt-1 mt-0.5">
                <span class="font-semibold text-zinc-700">寸法:</span> 身丈 ${item.sizeMitake || "ー"}cm / 裄 ${item.sizeYuki || "ー"}cm
              </div>
            ` : ""}
          </div>

          <div class="flex justify-between items-center text-[10px] text-zinc-400 border-t border-zinc-50 pt-2">
            <span class="flex items-center gap-1">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
              最終確認: <span class="font-medium ${isCompleted ? "text-emerald-700 font-semibold" : "text-zinc-400"}">${formatDate(item.lastAuditDate)}</span>
            </span>
            <button onclick="window.showItemDetail('${item.code}')" class="text-kimono-gold hover:text-amber-700 font-semibold flex items-center gap-0.5">
              詳細を表示 <i data-lucide="chevron-right" class="w-3 h-3"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");

    lucide.createIcons(); // 動的生成した要素のアイコンを有効化

  } catch (error) {
    console.error("在庫一覧の読込に失敗しました:", error);
    inventoryList.innerHTML = `<div class="text-center text-red-500 p-4">データの読み込みに失敗しました</div>`;
  }
}

// フィルター値変更イベントのバインディング
filterSearch.addEventListener("input", renderInventoryList);
filterType.addEventListener("change", renderInventoryList);
filterStatus.addEventListener("change", renderInventoryList);

// 棚卸し状況フィルターボタンの切り替え
function setAuditFilter(mode, activeBtn) {
  currentAuditFilter = mode;
  
  // 全ボタンのスタイルリセット
  const filterBtns = [btnFilterAll, btnFilterPending, btnFilterCompleted];
  filterBtns.forEach(btn => {
    btn.className = "flex-1 py-1.5 rounded-lg text-xs font-medium border border-kimono-gold/20 text-kimono-charcoal bg-kimono-cream hover:bg-kimono-gold/10 transition-all";
  });

  // アクティブボタンのみ黒背景に
  activeBtn.className = "flex-1 py-1.5 rounded-lg text-xs font-medium border border-kimono-gold text-white bg-kimono-charcoal transition-all";

  renderInventoryList();
}

btnFilterAll.addEventListener("click", (e) => setAuditFilter("all", e.currentTarget));
btnFilterPending.addEventListener("click", (e) => setAuditFilter("pending", e.currentTarget));
btnFilterCompleted.addEventListener("click", (e) => setAuditFilter("completed", e.currentTarget));

// グローバル露出用のクイック操作関数
window.quickAudit = async function(code) {
  try {
    const updated = await performAudit(code);
    playBeepSound();
    renderInventoryList();
    console.log(`棚卸し完了 (クイック): ${code}`);
  } catch (error) {
    alert("棚卸しの更新に失敗しました: " + error.message);
  }
};

window.quickStatusChange = async function(code, newStatus) {
  try {
    await updateItemStatus(code, newStatus);
    renderInventoryList();
  } catch (error) {
    alert("ステータスの更新に失敗しました: " + error.message);
  }
};

window.showItemDetail = async function(code) {
  const item = await fetchItemByCode(code);
  if (item) {
    openScanResultModal(item);
  }
};

// ==========================================
// 10. 新規登録 & QRコード生成・印刷
// ==========================================

// 商品番号の自動生成ロジック
btnGenCode.addEventListener("click", async () => {
  try {
    const items = await fetchAllItems();
    const now = new Date();
    const year = now.getFullYear();
    
    // KM-YYYY-XXX形式の最大値を検索する
    let maxNum = 0;
    const prefix = `KM-${year}-`;
    
    items.forEach(item => {
      if (item.code.startsWith(prefix)) {
        const numPart = item.code.replace(prefix, "");
        const num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });

    const nextNumString = String(maxNum + 1).padStart(3, "0");
    regCode.value = `${prefix}${nextNumString}`;
  } catch (err) {
    console.error("番号自動生成エラー:", err);
    regCode.value = `KM-${new Date().getFullYear()}-001`;
  }
});

// 新規登録フォームの送信処理
formRegisterItem.addEventListener("submit", async (e) => {
  e.preventDefault();

  const code = regCode.value.trim().toUpperCase();
  const name = regName.value.trim();
  const type = regType.value;
  const tailor = regTailor.value;
  const priceSale = regPriceSale.value ? parseInt(regPriceSale.value, 10) : null;
  const priceRent = regPriceRent.value ? parseInt(regPriceRent.value, 10) : null;
  const sizeMitake = regSizeMitake.value ? parseFloat(regSizeMitake.value) : null;
  const sizeYuki = regSizeYuki.value ? parseFloat(regSizeYuki.value) : null;
  const status = regStatus.value;

  const newItem = {
    code,
    name,
    type,
    tailor,
    priceSale,
    priceRent,
    sizeMitake,
    sizeYuki,
    status
  };

  try {
    // 1. DB (LocalStorage) に保存
    await saveNewItem(newItem);

    // 2. QRコード生成エリアのクリアと新規生成
    qrcodeContainer.innerHTML = ""; // コンテナ初期化
    
    // qrcode.js ライブラリ呼び出し
    new QRCode(qrcodeContainer, {
      text: code,
      width: 140,
      height: 140,
      colorDark: "#1E1E24",
      colorLight: "#FFFFFF",
      correctLevel: QRCode.CorrectLevel.H
    });

    // 3. 印刷用カードの各テキストの差し替え
    qrCodeText.textContent = code;
    qrNameText.textContent = name;
    qrTypeText.textContent = type;
    qrTailorText.textContent = tailor;

    // サイズが入力されていれば表示
    if (sizeMitake || sizeYuki) {
      qrSizeText.textContent = `身丈: ${sizeMitake || "ー"} / 裄丈: ${sizeYuki || "ー"} (cm)`;
      qrSizeText.classList.remove("hidden");
    } else {
      qrSizeText.classList.add("hidden");
    }

    // 4. 結果エリアの表示とスクロール
    qrResultArea.classList.remove("hidden");
    qrResultArea.scrollIntoView({ behavior: "smooth" });

    // フォームの入力内容をリセット
    formRegisterItem.reset();

  } catch (error) {
    alert("登録に失敗しました: " + error.message);
  }
});

// QR結果エリアを閉じる
btnCloseQrResult.addEventListener("click", () => {
  qrResultArea.classList.add("hidden");
});

// 商品タグ印刷の実行
btnPrintTag.addEventListener("click", () => {
  window.print();
});

// ==========================================
// 11. 初期化処理
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  // アイコンの初期生成
  lucide.createIcons();
  
  // アプリ起動時に在庫一覧の初期データを準備
  renderInventoryList();
});
