const mongoose = require('mongoose');

const treeAssetSchema = new mongoose.Schema({
  asset:           { type: String, required: true },       // e.g. 'BTC'
  margin:          { type: Number, required: true },       // % e.g. 10
  priceAtCreation: { type: Number, required: true },       // live price when tree was created
  entryPrice:      { type: Number, required: true },       // priceAtCreation × (1 - margin/100)
  profitGross:     { type: Number, required: true },       // priceAtCreation × (margin/100)
}, { _id: false });

const treeSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  channelId: { type: String, required: true },             // exchange id e.g. 'binance'
  name:      { type: String, default: null },              // optional user label
  assets:    { type: [treeAssetSchema], default: [] },
  totalProfitGross: { type: Number, default: 0 },          // sum of all asset profitGross (EPPT) values
  profitNet: { type: Number, default: 0 },                 // accumulated realized profit from deposits
}, { timestamps: true });

module.exports = mongoose.model('Tree', treeSchema);
