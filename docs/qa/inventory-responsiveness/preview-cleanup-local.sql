-- Optional after visual review only. Removes the exact supplemental preview IDs.
-- New references to these samples may block cleanup safely through foreign keys.
BEGIN;
DO $$ BEGIN
 IF current_database() != 'moqui' OR NOT EXISTS (SELECT 1 FROM organization WHERE party_id='LOCAL_ERP_ORG' AND organization_name='Local ERP Demo')
 THEN RAISE EXCEPTION 'Local ERP Demo database required'; END IF;
 IF EXISTS (SELECT 1 FROM product WHERE product_id IN ('RESP_INV_DEVICE','RESP_INV_BATCH') AND owner_party_id != 'LOCAL_ERP_ORG')
 THEN RAISE EXCEPTION 'Unexpected preview owner'; END IF;
END $$;
DELETE FROM demand_forecast WHERE forecast_id IN ('RESP_INV_FC1','RESP_INV_FC2');
DELETE FROM gate_pass_item WHERE (gate_pass_id,gate_pass_item_seq_id) IN (('RESP_INV_GP1','00001'),('RESP_INV_GP2','00001'));
DELETE FROM gate_pass WHERE gate_pass_id IN ('RESP_INV_GP1','RESP_INV_GP2');
DELETE FROM stock_adjustment_item WHERE stock_adjustment_id='RESP_INV_ADJ1' AND adjustment_item_seq_id='00001';
DELETE FROM stock_adjustment WHERE stock_adjustment_id='RESP_INV_ADJ1';
DELETE FROM product_serial_number WHERE serial_number_id IN ('RESP_INV_SN1','RESP_INV_SN2','RESP_INV_SN3','RESP_INV_SN4','RESP_INV_SN5');
DELETE FROM asset_receipt WHERE asset_receipt_id='RESP_INV_RECEIPT';
DELETE FROM order_item WHERE (order_id,order_item_seq_id) IN (('RESP_INV_PO1','00001'),('RESP_INV_PO2','00001'));
DELETE FROM order_part WHERE (order_id,order_part_seq_id) IN (('RESP_INV_PO1','01'),('RESP_INV_PO2','01'));
DELETE FROM order_header WHERE order_id IN ('RESP_INV_PO1','RESP_INV_PO2');
DELETE FROM asset_detail WHERE asset_detail_id IN ('RESP_INV_LEDGER1','RESP_INV_LEDGER2');
DELETE FROM asset WHERE asset_id IN ('RESP_INV_ASSET1','RESP_INV_ASSET2');
DELETE FROM product_category_member WHERE product_category_id='RESP_INV_CAT' AND product_id IN ('RESP_INV_DEVICE','RESP_INV_BATCH');
DELETE FROM product_category WHERE product_category_id='RESP_INV_CAT';
DELETE FROM product WHERE product_id IN ('RESP_INV_DEVICE','RESP_INV_BATCH');
COMMIT;
