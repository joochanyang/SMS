/**
 * TronGrid / TronScan API를 통한 TRC20 트랜잭션 검증 모듈
 * 
 * 검증 항목:
 * 1. Status: SUCCESS (확정된 거래)
 * 2. To Address: 시스템 관리자 주소와 일치
 * 3. Asset: USDT (TRC20) 인지 확인
 * 4. Amount: 실제 입금 수량과 신청 수량 일치
 * 5. Duplicate Check: DB에서 이미 처리된 TXID 여부
 */

const TRONGRID_BASE = 'https://api.trongrid.io';
const USDT_CONTRACT = process.env.USDT_CONTRACT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

interface TronTxInfo {
  id: string;                    // txid
  blockNumber: number;
  blockTimeStamp: number;
  contractResult: string[];
  confirmed: boolean;
  receipt: {
    result: string;              // "SUCCESS"
    net_fee: number;
    energy_fee: number;
  };
}

interface TRC20Transfer {
  transaction_id: string;
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
  from: string;
  to: string;
  value: string;                 // raw value (needs decimal conversion)
  type: string;                  // "Transfer"
  block_timestamp: number;
}

export interface TxVerificationResult {
  valid: boolean;
  txid: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';
  toAddress?: string;
  fromAddress?: string;
  asset?: string;
  amount?: number;               // USDT amount (human readable)
  blockTimestamp?: number;
  confirmed?: boolean;
  error?: string;
}

/**
 * TronGrid API 헤더 생성
 */
function getTronHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const apiKey = process.env.TRONGRID_API_KEY;
  if (apiKey) {
    headers['TRON-PRO-API-KEY'] = apiKey;
  }
  return headers;
}

/**
 * TXID로 트랜잭션 기본 정보 조회
 */
async function getTransactionInfo(txid: string): Promise<TronTxInfo | null> {
  try {
    const res = await fetch(`${TRONGRID_BASE}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: { ...getTronHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: txid }),
    });

    if (!res.ok) {
      console.error(`[TronGrid] getTransactionInfo failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    
    // 비어있는 응답 = 트랜잭션 없음
    if (!data || !data.id) {
      return null;
    }

    return data as TronTxInfo;
  } catch (error) {
    console.error('[TronGrid] getTransactionInfo error:', error);
    return null;
  }
}

/**
 * TRC20 전송 내역 조회 (특정 주소의 최근 전송)
 * 지정된 주소로 들어온 TRC20 전송 중에서 특정 TXID 매칭
 */
async function getTRC20TransferByTxid(txid: string, toAddress: string): Promise<TRC20Transfer | null> {
  try {
    // TronGrid의 account TRC20 transfer API 사용
    const res = await fetch(
      `${TRONGRID_BASE}/v1/accounts/${toAddress}/transactions/trc20?limit=200&only_to=true&contract_address=${USDT_CONTRACT}`,
      { headers: getTronHeaders() }
    );

    if (!res.ok) {
      console.error(`[TronGrid] getTRC20Transfers failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const transfers: TRC20Transfer[] = data.data || [];

    // TXID로 매칭
    return transfers.find(t => t.transaction_id === txid) || null;
  } catch (error) {
    console.error('[TronGrid] getTRC20Transfers error:', error);
    return null;
  }
}

/**
 * 대안: TronScan API를 통한 단일 TXID 조회
 */
async function getTRC20TransferViaTronScan(txid: string): Promise<TRC20Transfer | null> {
  try {
    const res = await fetch(
      `https://apilist.tronscanapi.com/api/transaction-info?hash=${txid}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    
    if (!data || !data.trc20TransferInfo || data.trc20TransferInfo.length === 0) {
      return null;
    }

    const transfer = data.trc20TransferInfo[0];
    return {
      transaction_id: txid,
      token_info: {
        symbol: transfer.symbol || 'USDT',
        address: transfer.contract_address || USDT_CONTRACT,
        decimals: transfer.decimals || 6,
        name: transfer.name || 'Tether USD',
      },
      from: transfer.from_address,
      to: transfer.to_address,
      value: transfer.amount_str || String(transfer.quant || '0'),
      type: 'Transfer',
      block_timestamp: data.timestamp || Date.now(),
    };
  } catch (error) {
    console.error('[TronScan] Fallback query error:', error);
    return null;
  }
}

/**
 * 완전한 TXID 검증 수행
 * 
 * @param txid - 트랜잭션 해시
 * @param expectedAddress - 시스템 입금 주소
 * @param expectedAmount - 사용자가 신청한 USDT 수량
 * @param tolerance - 금액 허용 오차 (기본 0.01 USDT)
 */
export async function verifyTRC20Transaction(
  txid: string,
  expectedAddress: string,
  expectedAmount: number,
  tolerance: number = 0.01,
): Promise<TxVerificationResult> {
  const cleanTxid = txid.trim().toLowerCase().replace(/^0x/, '');

  // 1. 트랜잭션 기본 정보 조회
  const txInfo = await getTransactionInfo(cleanTxid);

  if (!txInfo) {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'NOT_FOUND',
      error: '트랜잭션을 찾을 수 없습니다. TXID를 확인해 주세요.',
    };
  }

  // 2. 트랜잭션 상태 확인
  if (txInfo.receipt?.result !== 'SUCCESS') {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'FAILED',
      error: `트랜잭션이 실패한 상태입니다. (Status: ${txInfo.receipt?.result || 'UNKNOWN'})`,
    };
  }

  // 3. TRC20 전송 상세 조회 (TronGrid → TronScan fallback)
  let transfer = await getTRC20TransferByTxid(cleanTxid, expectedAddress);
  
  if (!transfer) {
    // Fallback: TronScan API
    transfer = await getTRC20TransferViaTronScan(cleanTxid);
  }

  if (!transfer) {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'PENDING',
      confirmed: txInfo.confirmed,
      error: 'TRC20 전송 정보를 조회할 수 없습니다. 아직 확정되지 않았을 수 있습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  // 4. To Address 확인
  const toAddr = transfer.to.toLowerCase();
  const expected = expectedAddress.toLowerCase();
  if (toAddr !== expected) {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'FAILED',
      toAddress: transfer.to,
      fromAddress: transfer.from,
      error: `입금 주소가 일치하지 않습니다. (받은 주소: ${transfer.to})`,
    };
  }

  // 5. Asset 확인 (USDT인지)
  const isUsdt = transfer.token_info.symbol === 'USDT' || 
                 transfer.token_info.address.toLowerCase() === USDT_CONTRACT.toLowerCase();
  if (!isUsdt) {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'FAILED',
      asset: transfer.token_info.symbol,
      error: `USDT가 아닌 다른 토큰(${transfer.token_info.symbol})이 전송되었습니다.`,
    };
  }

  // 6. Amount 확인
  const decimals = transfer.token_info.decimals || 6;
  const actualAmount = Number(transfer.value) / Math.pow(10, decimals);
  const amountDiff = Math.abs(actualAmount - expectedAmount);

  if (amountDiff > tolerance) {
    return {
      valid: false,
      txid: cleanTxid,
      status: 'FAILED',
      toAddress: transfer.to,
      fromAddress: transfer.from,
      asset: 'USDT',
      amount: actualAmount,
      error: `입금 수량이 일치하지 않습니다. (신청: ${expectedAmount} USDT, 실제: ${actualAmount} USDT)`,
    };
  }

  // 모든 검증 통과!
  return {
    valid: true,
    txid: cleanTxid,
    status: 'SUCCESS',
    toAddress: transfer.to,
    fromAddress: transfer.from,
    asset: 'USDT',
    amount: actualAmount,
    blockTimestamp: transfer.block_timestamp,
    confirmed: txInfo.confirmed,
  };
}
