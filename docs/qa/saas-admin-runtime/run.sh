#!/bin/sh
set -eu
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
QA_DIR="$ROOT/docs/qa/saas-admin-runtime"
COMPOSE="$QA_DIR/docker-compose.yml"
PROJECT=zenith-saas-admin-qa
OUT=${SAASADMIN_QA_OUT:-/tmp/zenith-saas-admin-qa/results}
mkdir -p "$OUT"
assert_project() {
    actual=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$1")
    [ "$actual" = "$PROJECT" ] || { echo 'Refusing to operate on another project' >&2; exit 1; }
}
case "${1:-start}" in
    stop)
        for container in zenith-saas-admin-qa-moqui-1 zenith-saas-admin-qa-db-1; do
            if docker inspect "$container" >/dev/null 2>&1; then assert_project "$container"; fi
        done
        docker compose -p "$PROJECT" -f "$COMPOSE" down -v
        exit 0;;
    test) exec python3 "$QA_DIR/acceptance.py";;
    start) ;;
    *) echo 'Usage: sh docs/qa/saas-admin-runtime/run.sh start|test|stop' >&2; exit 2;;
esac
[ -z "$(docker ps -aq --filter label=com.docker.compose.project="$PROJECT")" ] || { echo 'Existing QA stack: stop it before a fresh run.' >&2; exit 1; }
docker image inspect zetaerp-moqui:clean-staging >/dev/null
docker compose -p "$PROJECT" -f "$COMPOSE" up -d
assert_project zenith-saas-admin-qa-db-1
assert_project zenith-saas-admin-qa-moqui-1
CID=zenith-saas-admin-qa-moqui-1
docker exec "$CID" sh -c 'rm -rf /opt/moqui/runtime/component/zenith-erp-*'
if [ "$(uname)" = Darwin ]; then set -- --no-xattrs; else set --; fi
COPYFILE_DISABLE=1 tar "$@" -czf - component | docker exec -i "$CID" sh -c 'cd /opt/moqui/runtime/component && tar xzf - --strip-components=1'
for f in Login.xml Login.ftl qapps.xml; do docker cp "docs/infra/ci/base-overrides/$f" "$CID:/opt/moqui/runtime/base-component/webroot/screen/webroot/$f"; done
docker cp docs/infra/zenith-classes/. "$CID:/opt/moqui/runtime/classes/"
docker cp docs/infra/framework-patches "$CID:/tmp/ci-framework-patches"
docker exec "$CID" sh -c 'set -eu; P=/tmp/ci-framework-patches; sh "$P/patch-webroot-nav.sh"; sh "$P/patch-webroot-breadcrumb.sh"; sh "$P/patch-webroot-qavatar.sh"; sh "$P/patch-log4j2-authzfilter.sh"; for asset in WebrootVue.qvt.js WebrootVue.qvt.min.js; do F=/opt/moqui/runtime/base-component/webroot/screen/webroot/js/$asset; sh "$P/patch-webroot-lazy-rules.sh" "$F"; sh "$P/patch-webroot-inr-grid.sh" "$F"; done; for surface in html vuet qvt; do sh "$P/patch-macro-inr.sh" /opt/moqui/runtime/template/screen-macro/DefaultScreenMacros.$surface.ftl; done'
docker exec "$CID" mkdir -p /opt/moqui/runtime/component/ci-staging-fixtures/data /opt/moqui/runtime/component/ci-billing-fixtures/data
docker cp docs/infra/ci/seed/component.xml "$CID:/opt/moqui/runtime/component/ci-staging-fixtures/component.xml"
docker cp docs/infra/ci/seed/isolation.xml "$CID:/opt/moqui/runtime/component/ci-staging-fixtures/data/CiIsolationDemoData.xml"
docker cp docs/infra/ci/seed/billing-component.xml "$CID:/opt/moqui/runtime/component/ci-billing-fixtures/component.xml"
docker cp docs/infra/ci/seed/billing.xml "$CID:/opt/moqui/runtime/component/ci-billing-fixtures/data/CiBillingDemoData.xml"

docker exec "$CID" mkdir -p /opt/moqui/runtime/component/ci-saasadmin-fixtures/data
docker cp docs/qa/saas-admin-runtime/component.xml "$CID:/opt/moqui/runtime/component/ci-saasadmin-fixtures/component.xml"
docker cp docs/qa/saas-admin-runtime/MoquiConf.xml "$CID:/opt/moqui/runtime/component/ci-saasadmin-fixtures/MoquiConf.xml"
docker cp docs/qa/saas-admin-runtime/fixture.xml "$CID:/opt/moqui/runtime/component/ci-saasadmin-fixtures/data/SaasAdminDemoData.xml"
docker cp docs/qa/saas-admin-runtime/qa-screen.xml "$CID:/opt/moqui/runtime/component/zenith-erp-app/screen/zenith/SaasAdminQa.xml"
docker exec "$CID" sh -lc 'cd /opt/moqui && /opt/java/openjdk/bin/java -cp . MoquiStart load types=seed,seed-initial,demo no-run-es' > "$OUT/seed.log" 2>&1
printf 'Disposable seed command exited successfully\n'
COUNT=$(docker exec zenith-saas-admin-qa-db-1 psql -U moqui -d moqui -Atc "select count(*) from saas_tenant where tenant_id in ('SAASADMIN_QA_A','SAASADMIN_QA_B','SAASADMIN_QA_T','SAASADMIN_QA_S')")
[ "$COUNT" = 4 ] || { printf 'Fixture guard failed\n'; exit 1; }
docker exec "$CID" touch /tmp/ci-start-moqui

# Readiness uses the anonymous login screen, not customer data or a write transition.
for attempt in $(seq 1 60); do
    if curl --silent --fail http://127.0.0.1:18087/Login >/dev/null; then
        echo 'Disposable runtime ready at http://127.0.0.1:18087'; exit 0
    fi
    sleep 1
done
echo 'HTTP readiness failed; inspect disposable logs' >&2
exit 1
