const normalizePosSale = sale => ({
  externalId: String(sale.externalId || sale.id || ''),
  date: sale.date,
  hour: Number(sale.hour),
  revenue: Number(sale.revenue) || 0,
  orders: Number(sale.orders) || 0,
  branchId: String(sale.branchId || 'default'),
  promotion: Boolean(sale.promotion),
  weather: String(sale.weather || ''),
});

export class PosAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  async fetchHourlySales() {
    throw new Error('POS adapter chưa được cấu hình.');
  }

  normalizeMany(items) {
    return items.map(normalizePosSale);
  }
}

// Contract-ready placeholders. Actual endpoints and credentials must be kept
// in server-side secrets/Cloud Functions, never in the React client.
export class KiotVietAdapter extends PosAdapter {
  async fetchHourlySales() {
    throw new Error('Cần cấu hình KiotViet retailer, client ID và secret ở backend.');
  }
}

export class IposAdapter extends PosAdapter {
  async fetchHourlySales() {
    throw new Error('Cần hợp đồng API và credentials iPOS ở backend.');
  }
}

export { normalizePosSale };
