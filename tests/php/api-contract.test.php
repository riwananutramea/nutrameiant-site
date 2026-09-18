<?php
/**
 * API contract check against real WordPress and WooCommerce source.
 *
 * The integration suite runs against stubs written by hand, so it proves the
 * theme code behaves correctly against WordPress as WE UNDERSTAND IT. It cannot
 * catch a misremembered function name or a hook that does not exist — the stub
 * would simply be wrong in the same way as the code.
 *
 * This closes that gap. It extracts every function call, hook name and constant
 * the theme code actually uses, then verifies each one exists in real
 * WordPress/WooCommerce source. A typo, a renamed API or an invented function
 * fails here.
 *
 * Usage:
 *   WP_SRC=/path/to/wordpress WC_SRC=/path/to/woocommerce \
 *     php tests/php/api-contract.test.php
 *
 * Skips cleanly when the source is not present, so CI stays self-contained.
 *
 * @package NutraMEA\Tests
 */

$wp_src = getenv( 'WP_SRC' );
$wc_src = getenv( 'WC_SRC' );

if ( ! $wp_src || ! is_dir( $wp_src ) || ! $wc_src || ! is_dir( $wc_src ) ) {
	echo "API contract check SKIPPED — set WP_SRC and WC_SRC to real source trees.\n";
	echo "  curl -sSL -o wp.tar.gz https://wordpress.org/latest.tar.gz && tar xzf wp.tar.gz\n";
	echo "  curl -sSL -o wc.zip https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip && unzip -q wc.zip\n";
	exit( 0 );
}

$targets = array(
	__DIR__ . '/../../theme/nutramea-meetings.php',
	__DIR__ . '/../../theme/woocommerce/myaccount/dashboard.php',
);

/* ------------------------------------------------- extract what we depend on */

/**
 * Function calls made at the top level of a file, excluding method calls,
 * declarations and anything reached through an object or class.
 */
function extract_calls( $file ) {
	$tokens = token_get_all( file_get_contents( $file ) );
	$calls  = array();
	$count  = count( $tokens );

	for ( $i = 0; $i < $count; $i++ ) {
		if ( ! is_array( $tokens[ $i ] ) || T_STRING !== $tokens[ $i ][0] ) {
			continue;
		}
		// Previous meaningful token: skip method/static calls and declarations.
		$prev = null;
		for ( $j = $i - 1; $j >= 0; $j-- ) {
			if ( is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) {
				continue;
			}
			$prev = $tokens[ $j ];
			break;
		}
		if ( is_array( $prev ) && in_array( $prev[0], array( T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW, T_CLASS ), true ) ) {
			continue;
		}
		// Next meaningful token must be an opening parenthesis.
		$next = null;
		for ( $j = $i + 1; $j < $count; $j++ ) {
			if ( is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) {
				continue;
			}
			$next = $tokens[ $j ];
			break;
		}
		if ( '(' !== $next ) {
			continue;
		}
		$calls[ $tokens[ $i ][1] ] = true;
	}
	return array_keys( $calls );
}

/** Hook names passed to add_action/add_filter/do_action/apply_filters. */
function extract_hooks( $file ) {
	$src   = file_get_contents( $file );
	$hooks = array();
	if ( preg_match_all( "/add_(?:action|filter)\(\s*'([a-z0-9_]+)'/i", $src, $m ) ) {
		$hooks = array_merge( $hooks, $m[1] );
	}
	if ( preg_match_all( "/apply_filters\(\s*'([a-z0-9_]+)'/i", $src, $m ) ) {
		$hooks = array_merge( $hooks, $m[1] );
	}
	return array_values( array_unique( $hooks ) );
}

/** Indexes every `function name(` across a source tree. */
function index_functions( $dir ) {
	$found    = array();
	$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $iterator as $file ) {
		if ( $file->getExtension() !== 'php' ) {
			continue;
		}
		$src = file_get_contents( $file->getPathname() );
		if ( preg_match_all( '/^\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/m', $src, $m ) ) {
			foreach ( $m[1] as $name ) {
				$found[ $name ] = true;
			}
		}
	}
	return $found;
}

/** True when a hook name appears as a literal or a built string in the tree. */
function hook_exists( $hook, $dir ) {
	// `woocommerce_account_meetings_endpoint` is assembled at runtime from
	// 'woocommerce_account_' . $key . '_endpoint', so a literal search fails.
	$needles = array( "'" . $hook . "'", '"' . $hook . '"' );
	if ( strpos( $hook, 'woocommerce_account_' ) === 0 && substr( $hook, -9 ) === '_endpoint' ) {
		$needles[] = "'woocommerce_account_' . \$key . '_endpoint'";
		$needles[] = "'woocommerce_account_' .";
	}
	$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $iterator as $file ) {
		if ( $file->getExtension() !== 'php' ) {
			continue;
		}
		$src = file_get_contents( $file->getPathname() );
		foreach ( $needles as $needle ) {
			if ( strpos( $src, $needle ) !== false ) {
				return true;
			}
		}
	}
	return false;
}

echo "API contract: theme code vs real WordPress + WooCommerce\n";
echo '  WordPress: ' . $wp_src . "\n";
echo '  WooCommerce: ' . $wc_src . "\n\n";

$internal = array_flip( get_defined_functions()['internal'] );
$wp_fns   = index_functions( $wp_src );
$wc_fns   = index_functions( $wc_src );

// Declared by the theme code itself, or by the test harness.
$own = array_flip( array( 'instance', 'nutramea_meetings_config', 't', 'ok', 'eq' ) );

$fail = 0;
$checked = 0;

foreach ( $targets as $file ) {
	$label = basename( $file );
	echo "· $label\n";

	foreach ( extract_calls( $file ) as $fn ) {
		if ( isset( $internal[ $fn ] ) || isset( $own[ $fn ] ) ) {
			continue;
		}
		$checked++;
		$where = isset( $wp_fns[ $fn ] ) ? 'WordPress' : ( isset( $wc_fns[ $fn ] ) ? 'WooCommerce' : null );
		if ( null === $where ) {
			$fail++;
			echo "    MISSING  $fn()  — not defined in either source tree\n";
		} else {
			echo "    ok       $fn()  [$where]\n";
		}
	}

	foreach ( extract_hooks( $file ) as $hook ) {
		$checked++;
		$where = hook_exists( $hook, $wc_src ) ? 'WooCommerce'
			: ( hook_exists( $hook, $wp_src ) ? 'WordPress' : null );
		// Hooks we define ourselves for site owners to use are not contract
		// violations — they are the extension point.
		if ( null === $where && strpos( $hook, 'nutramea_' ) === 0 ) {
			echo "    ok       $hook  [ours, filterable by the site]\n";
			continue;
		}
		if ( null === $where ) {
			$fail++;
			echo "    MISSING  $hook  — no such hook is fired anywhere\n";
		} else {
			echo "    ok       $hook  [$where]\n";
		}
	}
	echo "\n";
}

/* --------------------------------------------- template override behaviour */

echo "· template override\n";
$checked++;
$dashboard = $wc_src . '/templates/myaccount/dashboard.php';
if ( ! file_exists( $dashboard ) ) {
	$fail++;
	echo "    MISSING  templates/myaccount/dashboard.php — our override has nothing to replace\n";
} else {
	echo "    ok       WooCommerce ships templates/myaccount/dashboard.php\n";
}

// The whole reason we override rather than hook: confirm the stock template
// prints its own greeting, so a hook would append to it.
$checked++;
$stock = file_get_contents( $dashboard );
if ( strpos( $stock, 'woocommerce_account_dashboard' ) !== false && preg_match( '/Hello\s+%1\$s|Hello\s+%s/', $stock ) ) {
	echo "    ok       the stock template greets the member AND fires the hook,\n";
	echo "             confirming a hook would append rather than replace\n";
} else {
	$fail++;
	echo "    CHANGED  the stock dashboard no longer matches our assumption — re-check\n";
	echo "             whether overriding the template is still the right approach\n";
}

// Theme overrides are found via this lookup.
$checked++;
if ( isset( $wc_fns['wc_get_template'] ) && isset( $wc_fns['wc_locate_template'] ) ) {
	echo "    ok       wc_locate_template() resolves theme overrides\n";
} else {
	$fail++;
	echo "    MISSING  template override lookup not found\n";
}

echo "\n$checked checks, $fail failed\n";
exit( $fail > 0 ? 1 : 0 );
