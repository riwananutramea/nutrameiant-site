#!/usr/bin/env bash
#
# Stands up a real WordPress + WooCommerce, installs the theme files exactly as
# the install instructions describe, and leaves it running for inspection.
#
# The stub suite in tests/php proves the theme code behaves correctly against
# WordPress as we understand it. This proves the understanding itself — that
# the endpoint really registers, that the template override really replaces
# WooCommerce's dashboard, that the member really lands on a working page.
#
# Needs: php (with pdo_sqlite), curl, unzip. No MySQL — WordPress runs on
# SQLite via the official integration plugin.
#
# Usage:
#   scripts/verify-wordpress.sh [workdir] [port]
#
set -euo pipefail

WORKDIR="${1:-/tmp/nutramea-wp-verify}"
PORT="${2:-8088}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://127.0.0.1:${PORT}"

echo "==> Workdir: $WORKDIR"
echo "==> URL:     $URL"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

# ---------------------------------------------------------------- downloads
[ -d wordpress ] || {
  echo "==> Downloading WordPress"
  curl -sSL -o wp.tar.gz https://wordpress.org/latest.tar.gz && tar xzf wp.tar.gz
}
[ -d woocommerce ] || {
  echo "==> Downloading WooCommerce"
  curl -sSL -o wc.zip https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip && unzip -q -o wc.zip
}
[ -d sqlite-database-integration ] || {
  echo "==> Downloading the SQLite integration"
  curl -sSL -o sqlite.zip https://downloads.wordpress.org/plugin/sqlite-database-integration.latest-stable.zip
  unzip -q -o sqlite.zip
}
[ -f wp-cli.phar ] || {
  echo "==> Downloading WP-CLI"
  curl -sSL -o wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
}
WP="php $WORKDIR/wp-cli.phar --allow-root"

cd wordpress

# ------------------------------------------------------------------ database
if [ ! -f wp-config.php ]; then
  echo "==> Configuring SQLite"
  cp -r "$WORKDIR/sqlite-database-integration" wp-content/plugins/
  cp wp-content/plugins/sqlite-database-integration/db.copy wp-content/db.php
  sed -i "s|{SQLITE_IMPLEMENTATION_FOLDER_PATH}|$WORKDIR/wordpress/wp-content/plugins/sqlite-database-integration|g" wp-content/db.php
  sed -i "s|{SQLITE_PLUGIN}|sqlite-database-integration/load.php|g" wp-content/db.php

  cat > wp-config.php <<PHPEOF
<?php
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', '' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'AUTH_KEY', 'local-verification-only-auth' );
define( 'SECURE_AUTH_KEY', 'local-verification-only-secure' );
define( 'LOGGED_IN_KEY', 'local-verification-only-logged-in' );
define( 'NONCE_KEY', 'local-verification-only-nonce' );
define( 'AUTH_SALT', 'local-verification-only-auth-salt' );
define( 'SECURE_AUTH_SALT', 'local-verification-only-secure-salt' );
define( 'LOGGED_IN_SALT', 'local-verification-only-logged-in-salt' );
define( 'NONCE_SALT', 'local-verification-only-nonce-salt' );
\$table_prefix = 'wp_';
// Pinned: WordPress otherwise infers a path-prefixed site URL from the
// directory it was installed into, which sets auth cookies on a path the
// browser never sends back, and every login silently fails.
define( 'WP_HOME', '${URL}' );
define( 'WP_SITEURL', '${URL}' );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }
require_once ABSPATH . 'wp-settings.php';
PHPEOF
fi

if ! $WP core is-installed 2>/dev/null; then
  echo "==> Installing WordPress"
  $WP core install --url="$URL" --title="NutraMEA Verification" \
    --admin_user=admin --admin_password=adminpass123 \
    --admin_email=admin@example.com --skip-email > /dev/null
  $WP option update home "$URL" > /dev/null
  $WP option update siteurl "$URL" > /dev/null
fi

# --------------------------------------------------------------- woocommerce
if ! $WP plugin is-active woocommerce 2>/dev/null; then
  echo "==> Activating WooCommerce"
  cp -r "$WORKDIR/woocommerce" wp-content/plugins/ 2>/dev/null || true
  $WP plugin activate woocommerce > /dev/null 2>&1
fi

# --------------------------------------------- the theme, per the instructions
echo "==> Installing the theme files under test"
T=wp-content/themes/nutramea-theme
mkdir -p "$T/woocommerce/myaccount"
cat > "$T/style.css" <<'CSSEOF'
/*
Theme Name: NutraMEA Theme
Version: 1.0
*/
CSSEOF
cat > "$T/index.php" <<'IDXEOF'
<?php get_header(); ?>
<main id="content">
<?php while ( have_posts() ) { the_post(); the_title( '<h1>', '</h1>' ); the_content(); } ?>
</main>
<?php get_footer(); ?>
IDXEOF
cat > "$T/header.php" <<'HDREOF'
<!doctype html><html <?php language_attributes(); ?>><head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
<style>
 body{margin:0;background:#0a0c0b;color:#f3f5f3;font-family:Inter,system-ui,sans-serif}
 .site-header{display:flex;align-items:center;gap:12px;padding:14px 24px;
   border-bottom:1px solid rgba(255,255,255,.1)}
 .site-header b{font-size:18px}.site-header b i{color:#b9ff39;font-style:normal}
 #content{max-width:1180px;margin:0 auto;padding:28px 24px;display:flex;gap:28px}
 #content > h1{display:none}
 .woocommerce{display:flex;gap:28px;width:100%}
 .woocommerce-MyAccount-navigation{flex:0 0 200px}
 .woocommerce-MyAccount-navigation ul{list-style:none;padding:0;margin:0;
   display:flex;flex-direction:column;gap:6px}
 .woocommerce-MyAccount-navigation a{padding:9px 12px;border-radius:8px;
   color:#d8ddd9;text-decoration:none;font-size:14px;display:block}
 .woocommerce-MyAccount-navigation .is-active a{background:rgba(185,255,57,.1);
   color:#b9ff39;font-weight:600}
 .woocommerce-MyAccount-content{flex:1;min-width:0}
 a{color:#b9ff39}
</style>
</head><body <?php body_class(); ?>>
<div class="site-header"><b>Nutra<i>MEA</i></b><span style="opacity:.6;font-size:13px">Intelligence</span></div>
HDREOF
echo '<?php wp_footer(); ?></body></html>' > "$T/footer.php"

cp "$REPO/theme/nutramea-meetings.php" "$T/nutramea-meetings.php"
cp "$REPO/theme/woocommerce/myaccount/dashboard.php" "$T/woocommerce/myaccount/dashboard.php"
rm -rf "$T/nutramea-meet"
cp -r "$REPO/site/meet" "$T/nutramea-meet"
# Development fixtures are not part of the theme.
rm -f "$T/nutramea-meet/embed-harness.html" "$T/nutramea-meet/dashboard-preview.html"

cat > "$T/functions.php" <<'FNEOF'
<?php
add_theme_support( 'woocommerce' );
// The single line the install instructions ask the site owner to add.
require_once get_stylesheet_directory() . '/nutramea-meetings.php';
FNEOF

$WP theme activate nutramea-theme > /dev/null 2>&1
$WP rewrite structure '/%postname%/' > /dev/null 2>&1
$WP rewrite flush --hard > /dev/null 2>&1

$WP user get member --field=ID > /dev/null 2>&1 || \
  $WP user create member member@example.com --role=customer \
    --user_pass=memberpass123 --first_name=Riwana \
    --display_name="Riwana Elshawadfi" > /dev/null

# ------------------------------------------------------------------- serve
cat > router.php <<'RTEOF'
<?php
// Router for PHP's built-in server: serve real files, send the rest to
// WordPress, which is what .htaccess does on a normal host.
$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$file = __DIR__ . $path;
if ( $path !== '/' && file_exists( $file ) && ! is_dir( $file ) ) { return false; }
if ( is_dir( $file ) && file_exists( rtrim( $file, '/' ) . '/index.html' ) ) { return false; }
$_SERVER['SCRIPT_NAME'] = '/index.php';
require __DIR__ . '/index.php';
RTEOF

pkill -f "php -S 127.0.0.1:${PORT}" 2>/dev/null || true
sleep 1
# Workers matter: a single-threaded server deadlocks on a browser's parallel
# requests and every page load times out.
PHP_CLI_SERVER_WORKERS=8 nohup php -S "127.0.0.1:${PORT}" -t . router.php \
  > "$WORKDIR/server.log" 2>&1 &
sleep 4

echo
echo "==> Ready"
for path in / /my-account/ /my-account/meetings/; do
  code=$(curl -sS -o /dev/null -m 20 -w '%{http_code}' "${URL}${path}")
  printf '    %-24s %s\n' "$path" "$code"
done
echo
echo "    Member login: member / memberpass123"
echo "    Admin login:  admin / adminpass123"
echo "    Server log:   $WORKDIR/server.log"
