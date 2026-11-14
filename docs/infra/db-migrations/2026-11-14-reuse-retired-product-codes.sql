-- Apply before starting the updated app. Existing product and barcode rows stay intact.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS product_active_code
    ON product (pseudo_id, owner_party_id) WHERE sales_discontinuation_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bc_product_value
    ON product_barcode (product_id, organization_party_id, barcode_value);

DROP INDEX IF EXISTS product_id_pseudo;
CREATE INDEX product_id_pseudo ON product (pseudo_id, owner_party_id);
DROP INDEX IF EXISTS bc_value;
CREATE INDEX bc_value ON product_barcode (organization_party_id, barcode_value);

COMMIT;
