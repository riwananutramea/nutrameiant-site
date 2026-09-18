<?php
/**
 * NutraMEA design tokens and brief subscriptions.
 *
 * GENERATED FILE. Built by tools/build.mjs from the repository stylesheets.
 * Edit site/assets/tokens.css, site/assets/site.css or
 * src/wordpress/nutramea-design.php.tpl and run `npm run build`.
 * Editing this file in WordPress will be overwritten on the next build.
 *
 * Install: see wordpress/README.md.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Loads the design tokens and site styles on every front end page.
 */
function nutramea_design_styles() {
	$css = <<<'NUTRAMEA_CSS'
{{css}}
NUTRAMEA_CSS;

	wp_register_style( 'nutramea-design', false, array(), '{{version}}' );
	wp_enqueue_style( 'nutramea-design' );
	wp_add_inline_style( 'nutramea-design', $css );
}
add_action( 'wp_enqueue_scripts', 'nutramea_design_styles', 20 );

/**
 * Registers POST /wp-json/nutramea/v1/subscribe, which the brief form posts to.
 */
function nutramea_register_subscribe_route() {
	register_rest_route(
		'nutramea/v1',
		'/subscribe',
		array(
			'methods'             => 'POST',
			'callback'            => 'nutramea_handle_subscribe',
			'permission_callback' => '__return_true',
			'args'                => array(
				'email' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'nutramea_register_subscribe_route' );

/**
 * Stores one subscriber address and notifies the site admin.
 *
 * @param WP_REST_Request $request Incoming request.
 * @return WP_REST_Response
 */
function nutramea_handle_subscribe( $request ) {
	$email = sanitize_email( (string) $request->get_param( 'email' ) );

	if ( ! is_email( $email ) ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'That email address is not valid.',
			),
			400
		);
	}

	// Five attempts per address per hour, so the route cannot be used to flood the list.
	$bucket   = 'nutramea_rate_' . md5( $email );
	$attempts = (int) get_transient( $bucket );

	if ( $attempts >= 5 ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'Too many attempts. Try again later.',
			),
			429
		);
	}

	set_transient( $bucket, $attempts + 1, HOUR_IN_SECONDS );

	$list = get_option( 'nutramea_subscribers', array() );

	if ( ! is_array( $list ) ) {
		$list = array();
	}

	if ( count( $list ) >= 20000 ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'The list is not accepting new addresses right now.',
			),
			503
		);
	}

	if ( ! isset( $list[ $email ] ) ) {
		$list[ $email ] = current_time( 'mysql' );
		update_option( 'nutramea_subscribers', $list, false );

		wp_mail(
			get_option( 'admin_email' ),
			'New brief subscriber',
			sprintf( "%s subscribed to the weekly brief.\n\nTotal subscribers: %d", $email, count( $list ) )
		);
	}

	return new WP_REST_Response(
		array(
			'ok'      => true,
			'message' => 'Subscribed.',
		),
		200
	);
}

/**
 * Exports the subscriber list as CSV for a logged in administrator.
 *
 * Visit /wp-admin/admin-post.php?action=nutramea_export_subscribers while signed in.
 */
function nutramea_export_subscribers() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Not allowed.', '', array( 'response' => 403 ) );
	}

	$list = get_option( 'nutramea_subscribers', array() );

	if ( ! is_array( $list ) ) {
		$list = array();
	}

	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename=nutramea-subscribers.csv' );

	$out = fopen( 'php://output', 'w' );
	fputcsv( $out, array( 'email', 'subscribed_at' ) );

	foreach ( $list as $email => $when ) {
		fputcsv( $out, array( $email, $when ) );
	}

	fclose( $out );
	exit;
}
add_action( 'admin_post_nutramea_export_subscribers', 'nutramea_export_subscribers' );
