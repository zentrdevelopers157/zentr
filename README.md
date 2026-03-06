# Zentr v1 - E-commerce Platform

A complete e-commerce platform for sellers and buyers with local JSON storage.

## Quick Start

```bash
cd server
npm install
npm start
```

Then visit:
- Buyer: http://localhost:3000/buyer?sellerId=demoSeller
- Seller: http://localhost:3000/seller.html

## API Routes

### Public Routes (Buyer-facing)
- `GET /api/public/sellers/:sellerId/products` - Get seller catalog
- `POST /api/public/sellers/:sellerId/checkout` - Create order
- `GET /api/public/sellers/:sellerId/orders/:orderId` - Track order
- `GET /api/public/sellers/:sellerId/orders/:orderId/receipt` - Get receipt

### Private Routes (Seller-facing)
- `GET /api/sellers/:sellerId/products` - Manage products
- `POST /api/sellers/:sellerId/products` - Add product
- `PATCH /api/sellers/:sellerId/products/:productId` - Update product
- `DELETE /api/sellers/:sellerId/products/:productId` - Delete product

## Data Schemas

### Product JSON Structure
```json
{
  "id": "prod_1772004404459_3df92077e7ebc8",
  "sellerId": "demoSeller",
  "name": "Oversized Tee",
  "price": 699,
  "images": [],
  "variants": [
    {
      "label": "Size",
      "options": [
        {
          "add": 0,
          "label": "M"
        },
        {
          "add": 1,
          "label": "L"
        }
      ]
    },
    {
      "label": "Color",
      "options": [
        {
          "add": 0,
          "label": "Black"
        },
        {
          "add": 1,
          "label": "White"
        }
      ]
    }
  ],
  "createdAt": "2026-02-25T07:26:44.460Z",
  "stock": 10
}
```

### Order JSON Structure
```json
{
  "id": "ORD1234567890",
  "sellerId": "demoSeller",
  "items": [
    {
      "productId": "prod_1772004404459_3df92077e7ebc8",
      "name": "Oversized Tee",
      "price": 699,
      "qty": 2,
      "variants": [
        {
          "caption": "Size",
          "optionId": "1"
        },
        {
          "caption": "Color",
          "optionId": "0"
        }
      ],
      "subtotal": 1398
    }
  ],
  "delivery": {
    "name": "John Doe",
    "phone": "+1234567890",
    "address": "123 Main St, City, State"
  },
  "paymentStatus": "pending",
  "total": 1398,
  "createdAt": "2026-02-28T12:34:56.789Z",
  "status": "confirmed"
}
```

## Key Features

### Buyer Flow
- Browse products by seller
- Mandatory variant selection (size, color, etc.)
- Add to cart with validation
- Persistent cart (localStorage)
- Checkout with delivery information
- Order confirmation and tracking

### Seller Flow
- Add/edit/delete products
- Set prices and variants
- Manage inventory
- Real-time catalog updates

### Technical Details
- **Storage**: Local JSON files (`data/products.json`, `data/orders.json`)
- **No Database**: Pure file-based storage for v1
- **Authentication**: Simple seller key system
- **Theme**: Glass morphism with turquoise accents
- **Responsive**: Mobile-first design

## File Structure
```
server/
├── index.js              # Express server and API routes
├── package.json           # Dependencies
├── data/                 # JSON storage
│   ├── products.json
│   └── orders.json
└── public/               # Static files
    ├── buyer.html       # Buyer interface
    ├── buyer.js         # Buyer logic
    ├── seller.html       # Seller interface
    ├── confirm.html      # Order confirmation
    ├── receipt.html      # Order receipt
    └── track.html        # Order tracking
```

## Development Notes

- Port: 3000 (configurable via PORT env var)
- CORS enabled for development
- Hot reload not included (use nodemon if needed)
- All routes logged to console
- Error handling with proper HTTP status codes
