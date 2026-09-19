<?php
/**
 * NutraMEA Intelligence — Member meetings.
 *
 * Adds "Meetings" to My Account: private, unlimited-length video calls that are
 * recorded in the member's own browser and saved to their own computer or their
 * own Google Drive.
 *
 * THIS IS NOT A PLUGIN. It is theme source code.
 *
 *   - No plugin header, so it never appears on the Plugins screen.
 *   - No activation or deactivation hook.
 *   - No custom database table, no custom post type, no admin screen.
 *   - One `require_once` line in functions.php turns it on. Deleting that line
 *     turns it off completely.
 *
 * Everything is configured from code, through a single filter, so the feature
 * lives in the repository and is reviewed like the rest of the theme rather
 * than drifting in a settings screen.
 *
 * COST: zero, permanently. The call runs on a public Jitsi deployment that
 * needs no account and no API key, and recording happens client-side. No code
 * path in this file or the app it loads can create a charge.
 *
 * INSTALL
 *   1. Copy this file to:            wp-content/themes/nutramea-theme/nutramea-meetings.php
 *   2. Copy the app folder to:       wp-content/themes/nutramea-theme/nutramea-meet/
 *      (the contents of site/meet/ — index.html plus assets/)
 *   3. Add to functions.php:         require_once get_stylesheet_directory() . '/nutramea-meetings.php';
 *   4. Visit Settings → Permalinks once and press Save, to register the endpoint.
 *
 * The page then appears at /my-account/meetings/ and in the My Account menu.
 *
 * @package NutraMEA
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'NutraMEA_Meetings' ) ) {

	/**
	 * Member meetings: routing, access control and app embedding.
	 */
	final class NutraMEA_Meetings {

		const VERSION       = '1.1.0';
		const ENDPOINT      = 'meetings';
		const APP_DIRECTORY = 'nutramea-meet';
		const REWRITE_FLAG  = 'nutramea_meetings_rewrites';
		// Standalone page, for platforms without WooCommerce account endpoints.
		const ROUTE         = 'meetings';
		const QUERY_FLAG    = 'nutramea_meeting_page';

		/**
		 * Singleton instance.
		 *
		 * @var NutraMEA_Meetings|null
		 */
		private static $instance = null;

		/**
		 * Boots the feature.
		 *
		 * @return NutraMEA_Meetings
		 */
		public static function instance() {
			if ( null === self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		/**
		 * Requests this feature must never touch.
		 *
		 * Signing in, signing up and activating an account are the paths that
		 * must work when everything else is broken. A meeting page is never
		 * worth risking them, so on these requests this feature registers
		 * nothing at all — there is no hook for it to misbehave through.
		 *
		 * Covers core's authentication entry points, plus the non-browser
		 * request types where our work is pointless and a failure is hardest
		 * to see: cron, XML-RPC and installation.
		 *
		 * @return bool
		 */
		public static function is_protected_request() {
			if ( defined( 'WP_INSTALLING' ) && WP_INSTALLING ) {
				return true;
			}
			if ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) {
				return true;
			}
			if ( function_exists( 'wp_doing_cron' ) ? wp_doing_cron() : ( defined( 'DOING_CRON' ) && DOING_CRON ) ) {
				return true;
			}

			// wp-login.php also serves registration, password reset and logout.
			$script = '';
			foreach ( array( 'SCRIPT_NAME', 'PHP_SELF', 'SCRIPT_FILENAME' ) as $key ) {
				if ( ! empty( $_SERVER[ $key ] ) ) {
					$script = basename( (string) wp_unslash( $_SERVER[ $key ] ) );
					break;
				}
			}

			return in_array(
				$script,
				array( 'wp-login.php', 'wp-signup.php', 'wp-activate.php', 'wp-register.php' ),
				true
			);
		}

		/**
		 * Registers hooks.
		 */
		private function __construct() {
			if ( self::is_protected_request() ) {
				return;
			}

			add_action( 'init', array( $this, 'register_endpoint' ) );
			add_action( 'init', array( $this, 'register_standalone_route' ) );
			add_filter( 'query_vars', array( $this, 'register_query_vars' ) );

			// Standalone /meetings/ page. This is the path that works on a
			// platform with a custom member area — which is most of them.
			// WooCommerce is treated as the optional extra, not the assumption.
			add_action( 'template_redirect', array( $this, 'maybe_render_standalone' ) );

			// WooCommerce My Account integration, if this site has one.
			add_filter( 'woocommerce_account_menu_items', array( $this, 'add_account_menu_item' ) );
			add_action( 'woocommerce_account_' . self::ENDPOINT . '_endpoint', array( $this, 'render_account_page' ) );

			// Works without WooCommerce too.
			add_shortcode( 'nutramea_meetings', array( $this, 'render_shortcode' ) );

			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );

			// Admin only, and never during AJAX. See maybe_flush_rewrites().
			add_action( 'admin_init', array( $this, 'maybe_flush_rewrites' ) );
		}

		/**
		 * Registers the permalink rules for /my-account/meetings/, once.
		 *
		 * `flush_rewrite_rules()` regenerates every rewrite rule on the site.
		 * WordPress is explicit that it must not run on ordinary page loads.
		 *
		 * An earlier version of this file called it from `wp_loaded`, guarded
		 * only by an option. That was wrong in a way worth spelling out: if the
		 * option write ever failed to stick — a persistent object cache serving
		 * a stale read, a momentarily read-only database — the guard never
		 * closed and the site flushed its rewrite rules on EVERY request,
		 * including sign-in. The symptom is not an error message; it is the
		 * whole site becoming slow enough to look broken, login first.
		 *
		 * So: admin only, never during AJAX, and only for someone who could
		 * have re-saved permalinks by hand anyway.
		 */
		public function maybe_flush_rewrites() {
			if ( ! is_admin() ) {
				return;
			}
			if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) {
				return;
			}
			if ( function_exists( 'current_user_can' ) && ! current_user_can( 'manage_options' ) ) {
				return;
			}
			if ( get_option( self::REWRITE_FLAG ) === self::VERSION ) {
				return;
			}

			// Record the attempt BEFORE flushing. If the flush fails, the site
			// is left with a 404 on one page — recoverable by re-saving
			// permalinks. If the record fails, a retry loop degrades the whole
			// site. The cheaper failure is the right one to accept.
			update_option( self::REWRITE_FLAG, self::VERSION, false );
			$this->register_endpoint();
			flush_rewrite_rules( false );
		}

		/* ---------------------------------------------------------- dashboard */

		/**
		 * Renders the My Account landing page.
		 *
		 * Called from the theme's `woocommerce/myaccount/dashboard.php`
		 * template, which REPLACES WooCommerce's own. Hooking onto
		 * `woocommerce_account_dashboard` instead would append to the stock
		 * "Hello {name}" boilerplate rather than replace it, leaving the page
		 * with two greetings.
		 *
		 * The secondary links are read from the live account menu, so this can
		 * never show a link to a section that does not exist, and never repeats
		 * the one already featured above it.
		 *
		 * @return string
		 */
		public function render_dashboard() {
			try {
				return $this->build_dashboard();
			} catch ( Throwable $error ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					error_log( 'NutraMEA dashboard render failed: ' . $error->getMessage() );
				}
				// Fall back to the greeting the member would otherwise have
				// seen, rather than an empty account page.
				return sprintf(
					'<p>%s</p>',
					esc_html(
						sprintf(
							/* translators: %s: member display name. */
							__( 'Hello, %s', 'nutramea' ),
							wp_get_current_user()->display_name
						)
					)
				);
			}
		}

		/**
		 * The actual dashboard markup.
		 *
		 * @return string
		 */
		private function build_dashboard() {
			if ( ! is_user_logged_in() ) {
				return '';
			}

			$user  = wp_get_current_user();
			$first = $user->first_name ? $user->first_name : $user->display_name;

			$links = '';
			if ( function_exists( 'wc_get_account_menu_items' ) ) {
				// Excluded: this page itself, logout, and the featured card.
				$skip  = array( 'dashboard', 'customer-logout', self::ENDPOINT );
				$items = array_diff_key( wc_get_account_menu_items(), array_flip( $skip ) );
				foreach ( $items as $endpoint => $label ) {
					$links .= sprintf(
						'<a class="nutramea-dash__link" href="%s">%s</a>',
						esc_url( wc_get_account_endpoint_url( $endpoint ) ),
						esc_html( $label )
					);
				}
			}

			// WooCommerce's endpoint when this site has one, otherwise the
			// standalone page. The old fallback hardcoded /my-account/, which
			// does not exist on a platform without WooCommerce — the button
			// would have pointed at a 404.
			$meetings_url = function_exists( 'wc_get_account_endpoint_url' )
				? wc_get_account_endpoint_url( self::ENDPOINT )
				: $this->route_url();

			$html = sprintf(
				'<div class="nutramea-dash">
					<p class="nutramea-dash__eyebrow">%1$s</p>
					<h2 class="nutramea-dash__greeting">%2$s</h2>

					<section class="nutramea-dash__feature">
						<h3>%3$s</h3>
						<p>%4$s</p>
						<a class="nutramea-dash__cta" href="%5$s">%6$s</a>
					</section>',
				esc_html__( 'Member dashboard', 'nutramea' ),
				/* translators: %s: member first name. */
				esc_html( sprintf( __( 'Hello, %s', 'nutramea' ), $first ) ),
				esc_html__( 'Meetings', 'nutramea' ),
				esc_html__( 'Private video calls with no time limit, recorded straight to your own computer. Notes, decisions and action items are written for you.', 'nutramea' ),
				esc_url( $meetings_url ),
				esc_html__( 'Start a meeting', 'nutramea' )
			);

			if ( '' !== $links ) {
				$html .= sprintf(
					'<nav class="nutramea-dash__links" aria-label="%s">%s</nav>',
					esc_attr__( 'Account sections', 'nutramea' ),
					$links
				);
			}

			return $html . '</div>';
		}

		/* ------------------------------------------------------------ routing */

		/**
		 * Registers the My Account endpoint.
		 */
		public function register_endpoint() {
			add_rewrite_endpoint( self::ENDPOINT, EP_ROOT | EP_PAGES );
		}

		/**
		 * Registers the standalone /meetings/ page.
		 *
		 * Most WordPress platforms do not have WooCommerce account endpoints —
		 * the member area is custom. Hooking only WooCommerce would mean this
		 * feature silently does nothing on those sites, which is the worst
		 * kind of failure: installed, no errors, no feature.
		 *
		 * So the real entry point is a plain route the theme owns. The
		 * WooCommerce integration stays as a bonus where it applies.
		 */
		public function register_standalone_route() {
			$route = $this->route_slug();
			add_rewrite_rule(
				'^' . preg_quote( $route, '/' ) . '/?$',
				'index.php?' . self::QUERY_FLAG . '=1',
				'top'
			);
			// /meetings/<room> opens an invite directly.
			add_rewrite_rule(
				'^' . preg_quote( $route, '/' ) . '/([^/]+)/?$',
				'index.php?' . self::QUERY_FLAG . '=1&meeting=$matches[1]',
				'top'
			);
		}

		/**
		 * The slug the standalone page lives at.
		 *
		 * Filterable so a site already using /meetings/ for something else can
		 * move it without editing this file.
		 *
		 * @return string
		 */
		public function route_slug() {
			$slug = apply_filters( 'nutramea_meetings_route', self::ROUTE );
			$slug = sanitize_title( (string) $slug );
			return '' === $slug ? self::ROUTE : $slug;
		}

		/** Public URL of the meetings page. */
		public function route_url() {
			return home_url( '/' . $this->route_slug() . '/' );
		}

		/**
		 * Renders the standalone page.
		 *
		 * Uses the theme's own header and footer, so the meeting sits inside
		 * the site rather than on a bare page.
		 */
		public function maybe_render_standalone() {
			if ( ! get_query_var( self::QUERY_FLAG ) ) {
				return;
			}

			// Per-member and never worth caching: the page carries the
			// member's own room, so a cached copy would hand one member's
			// room to another. LiteSpeed and friends honour these.
			if ( ! defined( 'DONOTCACHEPAGE' ) ) {
				define( 'DONOTCACHEPAGE', true );
			}
			nocache_headers();

			if ( ! is_user_logged_in() ) {
				wp_safe_redirect( $this->login_url( $this->route_url() ) );
				exit;
			}

			$this->output_standalone_page();
			exit;
		}

		/**
		 * Writes the standalone page.
		 *
		 * Kept separate from maybe_render_standalone() so the markup can be
		 * exercised without the `exit` that necessarily follows it in a real
		 * request — an `exit` inside the code under test ends the test run.
		 */
		public function output_standalone_page() {
			status_header( 200 );
			get_header();
			echo '<div class="nutramea-meet-page">';
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped within.
			echo $this->render();
			echo '</div>';
			get_footer();
		}

		/**
		 * Where to send a signed-out visitor.
		 *
		 * Platforms commonly have their own branded login page rather than
		 * wp-login.php, so this is filterable.
		 *
		 * @param string $redirect Where to return after signing in.
		 * @return string
		 */
		public function login_url( $redirect = '' ) {
			$url = apply_filters( 'nutramea_meetings_login_url', '', $redirect );
			if ( is_string( $url ) && '' !== $url ) {
				return $url;
			}
			return wp_login_url( $redirect );
		}

		/**
		 * Allows ?meeting=<slug> so an invite link can open a specific room.
		 *
		 * @param array $vars Registered query vars.
		 * @return array
		 */
		public function register_query_vars( $vars ) {
			$vars[] = 'meeting';
			$vars[] = self::QUERY_FLAG;
			return $vars;
		}

		/**
		 * Inserts "Meetings" into the My Account navigation.
		 *
		 * Placed before "Logout", which must stay last.
		 *
		 * @param array $items Existing menu items.
		 * @return array
		 */
		public function add_account_menu_item( $items ) {
			// Another part of the platform may already provide this entry.
			// Adding a second one would put "Meetings" in the menu twice.
			if ( isset( $items[ self::ENDPOINT ] ) ) {
				return $items;
			}

			$logout = null;
			if ( isset( $items['customer-logout'] ) ) {
				$logout = $items['customer-logout'];
				unset( $items['customer-logout'] );
			}

			$items[ self::ENDPOINT ] = __( 'Meetings', 'nutramea' );

			if ( null !== $logout ) {
				$items['customer-logout'] = $logout;
			}
			return $items;
		}

		/* ----------------------------------------------------------- settings */

		/**
		 * Client configuration handed to the app.
		 *
		 * Filterable so the deployment can be repointed — for example to a
		 * self-hosted meet.nutrameaint.com — without editing this file.
		 *
		 * Contains presentation settings only. Never put a secret here: it is
		 * visible to the browser by design.
		 *
		 * @return array
		 */
		public function get_client_config() {
			$config = array(
				'provider'  => 'jitsi',
				'jitsi'     => array(
					'domain'     => 'meet.jit.si',
					'roomPrefix' => 'NutraMEAInt',
				),
				'brandName' => get_bloginfo( 'name' ),
				'brandShort'=> 'NutraMEA Int.',
				// The surrounding My Account page already shows the logo, the
				// site name and a "Meetings" heading; the app drops its own.
				'embedded'  => true,
				'quality'   => 720,
				'notes'     => array(
					'enabled' => true,
					'engine'  => 'webspeech',
					'lang'    => str_replace( '_', '-', get_locale() ),
				),
				'storage'   => array(
					// Set this to enable one-click upload to the member's own
					// free Google Drive. Without it, recordings download to the
					// member's computer, which still costs nothing.
					'googleClientId' => '',
				),
			);

			/**
			 * Filters the meeting app configuration.
			 *
			 * @param array $config Client configuration.
			 */
			return apply_filters( 'nutramea_meetings_config', $config );
		}

		/**
		 * A stable, unguessable personal room for a member.
		 *
		 * Derived from the site's auth salt, so it cannot be predicted from the
		 * user ID, stays the same between visits, and never needs storing.
		 *
		 * @param int $user_id User ID.
		 * @return string
		 */
		public function personal_room( $user_id ) {
			$digest = hash_hmac( 'sha256', 'nutramea-room|' . (int) $user_id, wp_salt( 'auth' ) );
			return 'room-' . substr( $digest, 0, 20 );
		}

		/**
		 * URL of the embedded app, carrying room, name and configuration.
		 *
		 * @param int $user_id User ID.
		 * @return string
		 */
		public function app_url( $user_id ) {
			$requested = get_query_var( 'meeting' );
			$room      = is_string( $requested ) && '' !== $requested
				? sanitize_title( $requested )
				: $this->personal_room( $user_id );

			$user = get_userdata( $user_id );
			$name = $user ? $user->display_name : __( 'Member', 'nutramea' );

			// Presentation settings only. Anything sensitive goes through the
			// inline global in enqueue_assets(), which the URL cannot reach.
			$config = $this->get_client_config();
			unset( $config['storage'] );

			$packed = rtrim(
				strtr( base64_encode( wp_json_encode( $config ) ), '+/', '-_' ),
				'='
			);

			return add_query_arg(
				array(
					'room' => rawurlencode( $room ),
					'name' => rawurlencode( $name ),
					'cfg'  => $packed,
				),
				trailingslashit( get_stylesheet_directory_uri() ) . self::APP_DIRECTORY . '/index.html'
			);
		}

		/* ---------------------------------------------------------- rendering */

		/**
		 * Enqueues the wrapper stylesheet on pages that show the app.
		 */
		public function enqueue_assets() {
			if ( ! $this->is_meetings_context() ) {
				return;
			}
			wp_register_style( 'nutramea-meetings', false, array(), self::VERSION );
			wp_enqueue_style( 'nutramea-meetings' );
			wp_add_inline_style( 'nutramea-meetings', $this->wrapper_css() );

			// The trusted configuration channel.
			//
			// The app also receives settings through a `cfg` query parameter,
			// but its page is a static file anyone can link to with any `cfg`
			// they like — so the app treats that as hostile and accepts only a
			// narrow allowlist of presentation settings from it.
			//
			// Anything security-sensitive (the Google OAuth client, the Drive
			// scope) travels here instead: an inline global on THIS page. The
			// app frame is same-origin, so it reads the value through
			// window.parent, and an attacker has no way to write to it.
			wp_register_script( 'nutramea-meetings-config', false, array(), self::VERSION, false );
			wp_enqueue_script( 'nutramea-meetings-config' );
			wp_add_inline_script(
				'nutramea-meetings-config',
				'window.NUTRAMEA_MEET_CONFIG = ' . wp_json_encode( $this->get_client_config() ) . ';',
				'before'
			);
		}

		/**
		 * Whether the current request will render the meetings app.
		 *
		 * @return bool
		 */
		private function is_meetings_context() {
			global $wp_query;

			if ( isset( $wp_query->query_vars[ self::ENDPOINT ] ) ) {
				return true;
			}
			// The dashboard needs the same stylesheet.
			if ( function_exists( 'is_account_page' ) && is_account_page() ) {
				return true;
			}
			$post = get_post();
			return $post instanceof WP_Post && has_shortcode( (string) $post->post_content, 'nutramea_meetings' );
		}

		/**
		 * Styles for the embed wrapper only. The app styles itself.
		 *
		 * @return string
		 */
		private function wrapper_css() {
			return '
			.nutramea-dash{--nm-accent:#b9ff39;--nm-line:rgba(255,255,255,.1);
				--nm-muted:#9aa39c;--nm-surface:rgba(255,255,255,.02)}
			.nutramea-dash__eyebrow{display:flex;align-items:center;gap:.5rem;
				font-size:.6875rem;font-weight:650;letter-spacing:.09em;
				text-transform:uppercase;color:var(--nm-muted);margin:0 0 .75rem}
			.nutramea-dash__eyebrow:before{content:"";width:14px;height:2px;
				border-radius:1px;background:var(--nm-accent)}
			.nutramea-dash__greeting{font-size:1.5rem;font-weight:650;
				letter-spacing:-.02em;margin:0 0 1.75rem}
			.nutramea-dash__feature{border:1px solid var(--nm-line);border-radius:14px;
				padding:1.5rem;background:var(--nm-surface);margin-bottom:1.5rem}
			.nutramea-dash__feature h3{font-size:1.0625rem;font-weight:650;margin:0 0 .5rem}
			.nutramea-dash__feature p{margin:0 0 1.25rem;color:var(--nm-muted);
				font-size:.9375rem;line-height:1.6;max-width:56ch}
			.nutramea-dash__cta{display:inline-block;padding:.75rem 1.25rem;
				background:var(--nm-accent);color:#0a0c0b;border-radius:10px;
				font-weight:650;font-size:.9375rem;text-decoration:none}
			.nutramea-dash__cta:hover{background:#cbff6b;color:#0a0c0b}
			.nutramea-dash__links{display:flex;flex-wrap:wrap;gap:.5rem;
				padding-top:1.25rem;border-top:1px solid var(--nm-line)}
			.nutramea-dash__link{padding:.5rem .875rem;border:1px solid var(--nm-line);
				border-radius:8px;font-size:.8125rem;font-weight:600;
				color:inherit;text-decoration:none;opacity:.85}
			.nutramea-dash__link:hover{opacity:1;border-color:rgba(255,255,255,.22)}
			@media(max-width:620px){.nutramea-dash__cta{display:block;text-align:center}}
			.nutramea-meet{margin:0 0 1.5rem}
			.nutramea-meet__frame{width:100%;height:min(78vh,820px);min-height:560px;border:0;
				border-radius:12px;background:#0a0c0b;display:block}
			.nutramea-meet__note{margin-top:.75rem;font-size:.85rem;line-height:1.5;opacity:.75}
			.nutramea-meet__gate{padding:1.5rem;border:1px solid rgba(0,0,0,.12);border-radius:12px}
			@media(max-width:782px){.nutramea-meet__frame{height:min(72vh,640px);min-height:480px}}
			';
		}

		/**
		 * Renders the My Account → Meetings page.
		 */
		public function render_account_page() {
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped within.
			echo $this->render();
		}

		/**
		 * Shortcode handler.
		 *
		 * @return string
		 */
		public function render_shortcode() {
			return $this->render();
		}

		/**
		 * Builds the markup, and can never take the page down with it.
		 *
		 * This renders inside My Account, a page a member may be relying on to
		 * reach something else entirely. A fatal here would blank the whole
		 * page, so any failure degrades to a short message and the rest of the
		 * account area keeps working.
		 *
		 * @return string
		 */
		public function render() {
			try {
				return $this->render_frame();
			} catch ( Throwable $error ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					error_log( 'NutraMEA meetings render failed: ' . $error->getMessage() );
				}
				return sprintf(
					'<p class="nutramea-meet__gate">%s</p>',
					esc_html__( 'Meetings are temporarily unavailable. Everything else in your account is unaffected.', 'nutramea' )
				);
			}
		}

		/**
		 * The actual markup.
		 *
		 * @return string
		 */
		private function render_frame() {
			if ( ! is_user_logged_in() ) {
				return sprintf(
					'<div class="nutramea-meet__gate"><p>%s</p><p><a class="button" href="%s">%s</a></p></div>',
					esc_html__( 'Meetings are available to NutraMEA members. Please sign in to continue.', 'nutramea' ),
					esc_url( $this->login_url( $this->current_url() ) ),
					esc_html__( 'Sign in', 'nutramea' )
				);
			}

			$user_id = get_current_user_id();

			return sprintf(
				'<div class="nutramea-meet">
					<iframe
						class="nutramea-meet__frame"
						src="%1$s"
						title="%2$s"
						allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen; speaker-selection"
						allowfullscreen></iframe>
					<p class="nutramea-meet__note">%3$s</p>
				</div>',
				esc_url( $this->app_url( $user_id ) ),
				esc_attr__( 'NutraMEA member meeting', 'nutramea' ),
				esc_html__(
					'Your meeting room link is private to you. Recordings are made in your browser and saved to your own computer — nothing is stored on this website.',
					'nutramea'
				)
			);
		}

		/**
		 * Current request URL, used for the post-login redirect.
		 *
		 * @return string
		 */
		private function current_url() {
			$host = isset( $_SERVER['HTTP_HOST'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) : '';
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
			if ( '' === $host || '' === $uri ) {
				return home_url( '/' );
			}
			return ( is_ssl() ? 'https://' : 'http://' ) . $host . $uri;
		}
	}

	NutraMEA_Meetings::instance();
}

/*
 * Permalink registration deliberately lives on `admin_init`, inside
 * NutraMEA_Meetings::maybe_flush_rewrites(), NOT on a front-end hook.
 * See that method for why.
 */
