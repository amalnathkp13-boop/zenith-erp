# GRN incoming-stock verification

The workflow keeps the existing PO approval rule: prepare a draft GRN, save its receiving location and PO product quantities/unit costs, then submit it to Inventory Receiving. Submission reserves the PO balance without changing stock. Inventory confirmation records the actual received quantity through the existing stock ledger. Partial receipts remain incoming until completed; cancelling releases only the outstanding quantity. A supplier invoice reference or an existing matching vendor bill can be linked later without modifying billing records.

Legacy GRNs are not automatically converted into stock or inferred delivery lines. Their PO product mapping and delivery quantities require review.

Inventory → Receiving shows open, proposed and placed POs ahead of approval. A generated GRN appears as Draft until Purchase submits its delivery quantities. Legacy GRNs without a status on active purchase orders appear as Needs review. Only submitted quantities count as due on a GRN. Fully allocated PO quantities move out of the PO table to avoid counting the same delivery twice.

Use only a fresh, disposable loopback runtime as described in [purchase-remaining](../purchase-remaining/README.md), with the candidate components and canonical staging overrides. Bind HTTP to `127.0.0.1:18085` and H2 TCP to `127.0.0.1:19097`, database `mem:purchase-pricing-qa`. Enable `-Dpurchase.pricing.qa.disposable=true`, disable jobs and external delivery, and load the normal seed/demo data.

Copy `../purchase-remaining/fixture.xml` into the deployed Purchase component as `PurchaseRemainingQaFixture.xml`. Copy this directory's `qa-screen.xml` into the deployed Pricing screen directory as `GrnQa.xml`. Keep these fixture entry points out of deployed application components. Set `PURCHASE_QA_RUNTIME` to the deployment root containing `WEB-INF/lib`, `PURCHASE_QA_JAVA` to `java.exe` in a JDK, and `PURCHASE_QA_OUT` to a temporary output directory. Run `python docs/qa/purchase-grn/verify.py`. The runner uses the public demo password only in its isolated synthetic fixture accounts.

GRN initialization sets the disposable receiving organization’s purchasing currency to INR. The runner checks the currency of a new purchase order, its GRN, and the received asset. It also checks a direct receipt at ₹7.25 per unit and exercises invoice matching with INR and USD bills from the same supplier.

Checks cover draft and approved PO submission, reservation limits, repeated submissions, tenant/location/invoice/write boundaries, over-receipt, duplicate confirmation, partial/final receipts, recorded unit cost, cancellation and direct PO receipt compatibility. A separate SELECT-only JDBC connection verifies persisted quantities and unchanged invoice/payment fingerprints. Stop both disposable servers after success or failure to destroy the in-memory database. Never run the fixture harness against a customer environment.

Local verification also exercised actual partial and final receipt forms in the Quasar and Bootstrap interfaces. All four repository lint guards and `git diff --check` passed. Trusted staging must revalidate the candidate before release; no production change is performed by this suite.
