-- User-requested synthetic visual samples for the local demo only. Never import in production.
BEGIN;
DO $$ BEGIN
 IF current_database() != 'moqui' OR NOT EXISTS (SELECT 1 FROM organization WHERE party_id='LOCAL_ERP_ORG' AND organization_name='Local ERP Demo')
 THEN RAISE EXCEPTION 'Local ERP Demo database required'; END IF;
 IF EXISTS (SELECT 1 FROM product WHERE product_id IN ('RESP_INV_DEVICE','RESP_INV_BATCH')) THEN RAISE EXCEPTION 'Review IDs already exist'; END IF;
END $$;
INSERT INTO product(product_id,pseudo_id,product_name,product_type_enum_id,owner_party_id,inventory_tracked,enable_serial_tracking,enable_batch_tracking,mrp_amount) VALUES
('RESP_INV_DEVICE','DEMO-DEVICE','Sample Review Device','PtAsset','LOCAL_ERP_ORG','Y','Y','N',100),
('RESP_INV_BATCH','DEMO-BATCH','Sample Review Batch Item','PtAsset','LOCAL_ERP_ORG','Y','N','Y',50);
INSERT INTO asset(asset_id,product_id,owner_party_id,facility_id,asset_type_enum_id,status_id,has_quantity,quantity_on_hand_total,available_to_promise_total,valuation_rate,mrp_amount,batch_number,manufacturing_date,expiry_date) VALUES
('RESP_INV_ASSET1','RESP_INV_DEVICE','LOCAL_ERP_ORG','PREVIEW_SL_MAIN','AstTpInventory','AstAvailable','Y',5,5,60,100,NULL,NULL,NULL),
('RESP_INV_ASSET2','RESP_INV_BATCH','LOCAL_ERP_ORG','PREVIEW_SL_MAIN','AstTpInventory','AstAvailable','Y',12,12,30,50,'DEMO-LOT-001',CURRENT_DATE-30,CURRENT_DATE+14);
INSERT INTO asset_detail(asset_detail_id,asset_id,product_id,effective_date,quantity_on_hand_diff,available_to_promise_diff) VALUES
('RESP_INV_LEDGER1','RESP_INV_ASSET1','RESP_INV_DEVICE',CURRENT_TIMESTAMP,5,5),('RESP_INV_LEDGER2','RESP_INV_ASSET2','RESP_INV_BATCH',CURRENT_TIMESTAMP,12,12);
INSERT INTO product_serial_number(serial_number_id,serial_number,product_id,facility_id,asset_id,status_id,received_date,warranty_expiry_date) SELECT 'RESP_INV_SN'||n,'DEMO-SERIAL-00'||n,'RESP_INV_DEVICE','PREVIEW_SL_MAIN','RESP_INV_ASSET1','SnInStock',CURRENT_DATE,CURRENT_DATE+365 FROM generate_series(1,5) n;
INSERT INTO product_category(product_category_id,category_name,owner_party_id,product_category_type_enum_id,description) VALUES ('RESP_INV_CAT','Sample Review Catalogue','LOCAL_ERP_ORG','PctCatalog','Synthetic products for visual review');
INSERT INTO product_category_member(product_category_id,product_id,from_date) VALUES ('RESP_INV_CAT','RESP_INV_DEVICE',CURRENT_DATE),('RESP_INV_CAT','RESP_INV_BATCH',CURRENT_DATE);
INSERT INTO order_header(order_id,order_name,status_id,currency_uom_id,entry_date,placed_date) VALUES
('RESP_INV_PO1','Sample Review Purchase Order','OrderApproved','INR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('RESP_INV_PO2','Sample Review Second Order','OrderApproved','INR',CURRENT_TIMESTAMP-interval '2 days',CURRENT_TIMESTAMP-interval '2 days');
INSERT INTO order_part(order_id,order_part_seq_id,status_id,vendor_party_id,customer_party_id,facility_id) VALUES
('RESP_INV_PO1','01','OrderApproved','ORG_ZINC','LOCAL_ERP_ORG','PREVIEW_SL_MAIN'),
('RESP_INV_PO2','01','OrderApproved','ORG_ZINC','LOCAL_ERP_ORG','PREVIEW_SL_MAIN');
INSERT INTO order_item(order_id,order_item_seq_id,order_part_seq_id,item_type_enum_id,product_id,quantity,unit_amount,item_description) VALUES
('RESP_INV_PO1','00001','01','ItemProduct','RESP_INV_BATCH',10,30,'Sample Review Batch Item'),
('RESP_INV_PO2','00001','01','ItemProduct','RESP_INV_BATCH',8,30,'Sample Review Batch Item');
INSERT INTO asset_receipt(asset_receipt_id,asset_id,product_id,order_id,order_item_seq_id,received_date,quantity_accepted,quantity_rejected) VALUES ('RESP_INV_RECEIPT','RESP_INV_ASSET2','RESP_INV_BATCH','RESP_INV_PO1','00001',CURRENT_TIMESTAMP,3,0);
INSERT INTO stock_adjustment(stock_adjustment_id,organization_party_id,facility_id,adjustment_type,adjustment_date,status_id,remarks) VALUES ('RESP_INV_ADJ1','LOCAL_ERP_ORG','PREVIEW_SL_MAIN','PhysicalCount',CURRENT_TIMESTAMP,'AdjPending','Synthetic pending count for review');
INSERT INTO stock_adjustment_item(stock_adjustment_id,adjustment_item_seq_id,product_id,asset_id,system_quantity,actual_quantity,difference_quantity,valuation_rate) VALUES ('RESP_INV_ADJ1','00001','RESP_INV_BATCH','RESP_INV_ASSET2',12,11,-1,30);
INSERT INTO gate_pass(gate_pass_id,organization_party_id,pass_type_enum_id,facility_id,party_id,issue_date,expected_return_date,status_id,remarks) VALUES
('RESP_INV_GP1','LOCAL_ERP_ORG','GptRgp','PREVIEW_SL_MAIN','ORG_ZINC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '7 days','GpIssued','Synthetic returnable sample for review'),
('RESP_INV_GP2','LOCAL_ERP_ORG','GptNrgp','PREVIEW_SL_MAIN','ORG_ZINC',CURRENT_TIMESTAMP,NULL,'GpIssued','Synthetic non-returnable sample for review');
INSERT INTO gate_pass_item(gate_pass_id,gate_pass_item_seq_id,product_id,description,quantity,returned_quantity) VALUES ('RESP_INV_GP1','00001','RESP_INV_DEVICE','Sample Review Device',1,0),('RESP_INV_GP2','00001','RESP_INV_BATCH','Sample Review Batch Item',1,0);
INSERT INTO demand_forecast(forecast_id,product_id,period_start,period_end,forecast_quantity,actual_quantity,forecast_method_enum_id,accuracy_percent,reorder_point,safety_stock,suggested_order_qty) VALUES
('RESP_INV_FC1','RESP_INV_DEVICE',date_trunc('month',CURRENT_DATE)::date,(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,20,18,'FmMovingAvg',90,10,3,15),
('RESP_INV_FC2','RESP_INV_BATCH',date_trunc('month',CURRENT_DATE)::date,(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,30,27,'FmMovingAvg',90,15,5,18);
COMMIT;
