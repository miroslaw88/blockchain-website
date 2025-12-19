// Payment calculation constants and functions

export const PRICE_PER_BYTE = 0.0000000001; // $0.0000000001 per byte
export const TOKEN_PRICE = 1.00; // $1.00 per stake token

// Calculate payment for buy storage: storage_bytes * price_per_byte * token_price
export function calculateBuyStoragePayment(storageBytes: number): string {
    const stakeAmount = storageBytes * PRICE_PER_BYTE * TOKEN_PRICE;
    // Round to 6 decimal places (matching stake decimals)
    const rounded = Math.round(stakeAmount * 1000000) / 1000000;
    return `${rounded}stake`;
}

// Calculate payment for extend storage: storage_bytes * duration_days * price_per_byte * token_price
export function calculateExtendStoragePayment(storageBytes: number, durationDays: number): string {
    const stakeAmount = storageBytes * durationDays * PRICE_PER_BYTE * TOKEN_PRICE;
    // Round to 6 decimal places (matching stake decimals)
    const rounded = Math.round(stakeAmount * 1000000) / 1000000;
    return `${rounded}stake`;
}

