/**
 * 着物在庫管理・棚卸システム - データ連携モジュール (api.js)
 * 
 * このモジュールは、アプリのデータアクセス（CRUDおよび棚卸更新）を抽象化します。
 * 初期状態ではブラウザの LocalStorage を使用しますが、
 * 「USE_GAS_API」を true に設定し、GASのWebアプリURLを入力することで、
 * 簡単にGoogleスプレッドシート連携へ切り替えることができます。
 */

// ==========================================
// 1. 設定パラメータ
// ==========================================
// Google Apps Script (GAS) の連携を有効にする場合は true にします。
const USE_GAS_API = false; 

// デプロイした GAS Webアプリ の URL をここに貼り付けます。
const GAS_API_URL = "https://script.google.com/macros/s/XXXXX_YOUR_GAS_API_URL_XXXXX/exec";

// LocalStorageのキー名
const LOCAL_STORAGE_KEY = "kimono_inventory_data";

// ==========================================
// 2. 初期テストデータ (LocalStorageが空の場合のみ使用)
// ==========================================
const DEFAULT_ITEMS = [
  {
    code: "KM-2026-001",
    name: "本加賀友禅 訪問着（四季草花文様）",
    type: "訪問着",
    tailor: "仕立て上がり",
    priceSale: 380000,
    priceRent: 120000,
    sizeMitake: 165.0,
    sizeYuki: 67.5,
    status: "保管中",
    lastAuditDate: "2026-06-01T10:30:00.000Z" // ISOタイムスタンプ (完了済)
  },
  {
    code: "KM-2026-002",
    name: "十日町友禅 振袖（束ね熨斗）",
    type: "振袖",
    tailor: "レンタル用",
    priceSale: null,
    priceRent: 180000,
    sizeMitake: 168.0,
    sizeYuki: 69.0,
    status: "レンタル中",
    lastAuditDate: "2026-06-03T15:20:00.000Z" // ISOタイムスタンプ (完了済)
  },
  {
    code: "KM-2026-003",
    name: "本場大島紬 反物（泥染 龍郷柄）",
    type: "反物",
    tailor: "反物",
    priceSale: 240000,
    priceRent: null,
    sizeMitake: null,
    sizeYuki: null,
    status: "保管中",
    lastAuditDate: "" // 未棚卸
  },
  {
    code: "KM-2026-004",
    name: "西陣織 袋帯（唐織 金糸）",
    type: "帯",
    tailor: "仕立て上がり",
    priceSale: 120000,
    priceRent: 40000,
    sizeMitake: null,
    sizeYuki: null,
    status: "保管中",
    lastAuditDate: "" // 未棚卸
  }
];

// ==========================================
// 3. データ処理共通ヘルパー (内部用)
// ==========================================

// LocalStorageの初期化・取得
function getLocalData() {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!data) {
    // データがない場合はデフォルトデータを登録して返す
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_ITEMS));
    return DEFAULT_ITEMS;
  }
  return JSON.parse(data);
}

// LocalStorageへの保存
function saveLocalData(data) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

// ==========================================
// 4. エクスポート関数 (外部呼び出し用API)
// ==========================================

/**
 * 全在庫データを取得する
 * @returns {Promise<Array>} 着物データの配列
 */
export async function fetchAllItems() {
  if (USE_GAS_API) {
    try {
      const response = await fetch(`${GAS_API_URL}?action=getAll`);
      if (!response.ok) throw new Error("GAS APIとの通信に失敗しました");
      const result = await response.json();
      return result.data; // GASから { status: "success", data: [...] } で返却される想定
    } catch (error) {
      console.error("GASからのデータ取得エラー。LocalStorageにフォールバックします:", error);
      return getLocalData();
    }
  } else {
    // ローカルストレージから即時返却 (Promiseでラップ)
    return getLocalData();
  }
}

/**
 * 商品番号から特定の着物データを取得する
 * @param {string} code 商品番号
 * @returns {Promise<Object|null>} 着物データ、見つからない場合はnull
 */
export async function fetchItemByCode(code) {
  const items = await fetchAllItems();
  return items.find(item => item.code === code) || null;
}

/**
 * 新規着物データを登録する
 * @param {Object} item 新規着物オブジェクト
 * @returns {Promise<boolean>} 成功したかどうか
 */
export async function saveNewItem(item) {
  // バリデーション
  if (!item.code || !item.name) {
    throw new Error("商品番号と商品名は必須です。");
  }

  // タイムスタンプ初期設定
  const newItem = {
    ...item,
    priceSale: item.priceSale ? Number(item.priceSale) : null,
    priceRent: item.priceRent ? Number(item.priceRent) : null,
    sizeMitake: item.sizeMitake ? Number(item.sizeMitake) : null,
    sizeYuki: item.sizeYuki ? Number(item.sizeYuki) : null,
    lastAuditDate: item.lastAuditDate || "" // 新規登録時は基本空
  };

  if (USE_GAS_API) {
    try {
      const response = await fetch(GAS_API_URL, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "register",
          data: newItem
        })
      });
      if (!response.ok) throw new Error("GASへの登録要求に失敗しました");
      const result = await response.json();
      return result.status === "success";
    } catch (error) {
      console.error("GASへの登録に失敗しました。LocalStorageで実行します:", error);
      // フォールバック
    }
  }

  // LocalStorageでの実装
  const items = getLocalData();
  // 重複チェック
  if (items.some(x => x.code === newItem.code)) {
    throw new Error(`商品番号「${newItem.code}」は既に登録されています。`);
  }
  items.push(newItem);
  saveLocalData(items);
  return true;
}

/**
 * スキャンまたは手動による棚卸し処理（実在確認）を実行する
 * 最終棚卸確認日を現在時刻に更新し、必要であれば在庫ステータスも更新する
 * @param {string} code 対象の商品番号
 * @param {string} [newStatus] オプション：更新する新しい在庫ステータス
 * @returns {Promise<Object>} 更新された着物オブジェクト
 */
export async function performAudit(code, newStatus = null) {
  const currentTimestamp = new Date().toISOString();

  if (USE_GAS_API) {
    try {
      const response = await fetch(GAS_API_URL, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "audit",
          code: code,
          status: newStatus,
          timestamp: currentTimestamp
        })
      });
      if (!response.ok) throw new Error("GASへの棚卸し更新に失敗しました");
      const result = await response.json();
      if (result.status === "success") {
        return result.data;
      }
    } catch (error) {
      console.error("GASでの棚卸更新に失敗しました。LocalStorageで実行します:", error);
      // フォールバック
    }
  }

  // LocalStorageでの実装
  const items = getLocalData();
  const index = items.findIndex(item => item.code === code);
  
  if (index === -1) {
    throw new Error(`商品番号「${code}」が見つかりません。`);
  }

  // データの書き換え
  items[index].lastAuditDate = currentTimestamp;
  if (newStatus) {
    items[index].status = newStatus;
  }
  
  saveLocalData(items);
  return items[index];
}

/**
 * 在庫ステータスのみを更新する
 * @param {string} code 対象の商品番号
 * @param {string} status 新しいステータス
 * @returns {Promise<Object>} 更新された着物オブジェクト
 */
export async function updateItemStatus(code, status) {
  if (USE_GAS_API) {
    try {
      const response = await fetch(GAS_API_URL, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "updateStatus",
          code: code,
          status: status
        })
      });
      if (!response.ok) throw new Error("GASへのステータス更新に失敗しました");
      const result = await response.json();
      if (result.status === "success") return result.data;
    } catch (error) {
      console.error("GASでのステータス更新失敗。LocalStorageで処理します:", error);
    }
  }

  const items = getLocalData();
  const index = items.findIndex(item => item.code === code);
  
  if (index === -1) {
    throw new Error(`商品番号「${code}」が見つかりません。`);
  }

  items[index].status = status;
  saveLocalData(items);
  return items[index];
}
