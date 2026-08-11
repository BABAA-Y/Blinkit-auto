export interface CatalogItem {
  sku: string;
  name: string;
  pricePaise: number;
  available: boolean;
  availableQuantity: number;
}

export interface WishlistItem {
  id: string;
  productIdentifier: string;
  productName: string;
  quantity: number;
  maximumUnitPricePaise: number;
  enabled: boolean;
  cooldownMinutes: number;
}

export enum DecisionReason {
  APPROVED = "APPROVED",
  DISABLED = "DISABLED",
  PRODUCT_NOT_FOUND = "PRODUCT_NOT_FOUND",
  OUT_OF_STOCK = "OUT_OF_STOCK",
  INSUFFICIENT_QUANTITY = "INSUFFICIENT_QUANTITY",
  PRICE_TOO_HIGH = "PRICE_TOO_HIGH",
  MAX_ORDER_VALUE_EXCEEDED = "MAX_ORDER_VALUE_EXCEEDED",
  DAILY_BUDGET_EXCEEDED = "DAILY_BUDGET_EXCEEDED",
  MONTHLY_BUDGET_EXCEEDED = "MONTHLY_BUDGET_EXCEEDED",
  COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE",
  DUPLICATE_ORDER = "DUPLICATE_ORDER",
  INVALID_PROVIDER_DATA = "INVALID_PROVIDER_DATA",
  INVALID_ELIGIBILITY_DECISION = "INVALID_ELIGIBILITY_DECISION",
}

export interface Decision {
  approved: boolean;
  reason: DecisionReason;
  wishlistItemId: string;
  productIdentifier: string;
  quantity: number;
  unitPricePaise?: number;
  orderValuePaise?: number;
  item?: CatalogItem;
  decidedAt: Date;
}

export interface EligibilityLimits {
  maximumOrderValuePaise: number;
  dailySpendingLimitPaise: number;
  monthlySpendingLimitPaise: number;
  duplicateOrderWindowMinutes: number;
}

export enum OrderStatus {
  REJECTED = "REJECTED",
  DUPLICATE = "DUPLICATE",
  PROCESSING = "PROCESSING",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  SUBMISSION_FAILED = "SUBMISSION_FAILED",
  SUBMITTED = "SUBMITTED",
}

export interface OrderRecord {
  id: number;
  productIdentifier: string;
  productName?: string;
  quantity: number;
  unitPricePaise?: number;
  totalPaise?: number;
  decision: boolean;
  reason: DecisionReason;
  timestamp: Date;
  status: OrderStatus;
  paymentReference?: string;
  submissionReference?: string;
  idempotencyKey: string;
}
