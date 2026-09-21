/*
 * Le lecteur video du son spatial.
 *
 * Cette page n est jamais vue. Elle est ouverte dans un cadre transparent par
 * l interface, avec l identifiant de la video en parametre, et elle n a qu un
 * seul but : rendre accessible la balise <video> du lecteur.
 *
 * C est le detour oblige. Le lecteur de la plateforme ne sait sortir que sur
 * les haut-parleurs ; il ignore tout de la spatialisation. Mais la balise
 * qu il pilote, elle, est une source audio comme une autre : le moteur du son
 * spatial la branche dans sa chaine, et la video se retrouve posee dans le
 * monde comme un fichier.
 *
 * Le lecteur demarre MUET : une page web n a le droit de jouer toute seule que
 * si elle ne fait pas de bruit. Mais une balise muette ne produit aucun signal,
 * pas meme vers un moteur audio — la coupure est a la source, pas a la sortie.
 * Le parent la reveille donc par un message `unmute`, une fois qu il l a
 * branchee dans sa chaine : a ce moment-la le son ne peut plus sortir en
 * direct, la chaine a pris sa place.
 *
 * Une limite a connaitre : la balise vit dans un cadre d un autre domaine, et
 * un navigateur ordinaire en refuse l acces. L interface du jeu ne l applique
 * pas, ce qui rend ce fichier inutilisable hors du jeu. C est aussi pour cela
 * que l echec est signale proprement plutot que laisse en suspens.
 */
(function () {
	"use strict";

	var params = new URLSearchParams(window.location.search);
	var videoId = params.get("v") || "";
	var seek = parseFloat(params.get("seek") || "0") || 0;
	var loop = params.get("loop") === "1";
	var player = null;
	var linked = false;
	var watchdog = null;
	var watchdogAudible = false;

	/** Prevenir le parent, qui decide quoi en faire. */
	function tell(type, data) {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ type: type, data: data }, "*");
		}
	}

	/**
	 * Aller chercher la balise dans le cadre du lecteur.
	 *
	 * Elle n existe qu une fois la lecture commencee : avant, le lecteur n a
	 * pose qu une image d attente. On reessaie donc, sans s acharner.
	 */
	function grabVideo(attempt) {
		var frame = document.querySelector("#player iframe") || document.getElementById("player");
		var video = null;

		try {
			video = frame && frame.contentWindow && frame.contentWindow.document
				? frame.contentWindow.document.querySelector("video")
				: null;
		} catch (error) {
			return tell("error", { message: "cadre inaccessible" });
		}

		if (video) {
			video.loop = loop;

			// La balise est publiee telle quelle : c est le parent qui la
			// branche, et lui seul sait dans quelle chaine.
			window.videoSource = video;

			return tell("ready", { duration: video.duration || 0 });
		}

		if (attempt > 100) return tell("error", { message: "balise video introuvable" });

		window.setTimeout(function () { grabVideo(attempt + 1); }, 100);
	}

	/**
	 * Le chien de garde de la lecture.
	 *
	 * `playVideo()` est une DEMANDE, pas une garantie. Le navigateur decide, et
	 * il decide sur des criteres qu on ne controle pas : le lecteur est-il juge
	 * visible, la page a-t-elle recu un geste, la mise en page a-t-elle change.
	 * Un refus ne leve rien et ne se signale nulle part — le lecteur reste
	 * simplement en attente, et repart tout seul plus tard, quand quelque chose
	 * bouge a l ecran. Fermer un menu suffisait, et la musique partait alors
	 * plusieurs secondes apres le clic, sans que rien n explique pourquoi.
	 *
	 * On cesse donc d attendre son bon vouloir : on redemande, jusqu a ce que le
	 * temps de lecture AVANCE vraiment. C est la seule preuve qui vaille — un
	 * lecteur peut se dire « en lecture » sans qu une image ne bouge.
	 */
	function keepPlaying(audible) {
		// Le passage muet -> audible est une NOUVELLE tentative d autoplay. Le
		// premier chien de garde pouvait avoir valide la lecture muette juste
		// avant que `unMute()` ne la remette en pause. On repart donc de zero
		// quand le parent a branche la source.
		if (watchdog !== null) {
			if (audible && !watchdogAudible) {
				window.clearInterval(watchdog);
				watchdog = null;
			} else {
				return;
			}
		}

		watchdogAudible = audible === true;

		var last = -1;
		var tries = 0;
		var stable = 0;

		watchdog = window.setInterval(function () {
			var video = window.videoSource;

			// La balise n est pas encore la : `grabVideo` s en occupe, on
			// attend son tour.
			if (!video) {
				if (tries++ > 60) {
					window.clearInterval(watchdog);
					watchdog = null;
				}

				return;
			}

			var unmuted = !watchdogAudible
				|| (!video.muted && (!player || !player.isMuted || !player.isMuted()));

			// Deux mesures consecutives : une image avancee juste avant l unmute
			// ne suffit pas a affirmer que le son continue APRES ce passage.
			if (unmuted && !video.paused && last >= 0 && video.currentTime > last + 0.05) {
				stable++;

				if (stable >= 2) {
					window.clearInterval(watchdog);
					watchdog = null;

					return tell("playing", { at: video.currentTime, audible: watchdogAudible });
				}
			} else {
				stable = 0;
			}

			last = video.currentTime;

			if (tries++ > 60) {
				window.clearInterval(watchdog);
				watchdog = null;

				return tell("error", { message: "le lecteur refuse de demarrer" });
			}

			try {
				// Le reveil que le lecteur attend, on le lui donne nous-memes :
				// une mise en page qui bouge — la taille du lecteur, d un pixel,
				// et l evenement de redimensionnement — est exactement ce que
				// fermer un menu provoquait, et ce sur quoi il repartait.
				if (player && player.setSize) player.setSize(356 + (tries % 2), 200);

				window.dispatchEvent(new Event("resize"));

				if (player) {
					if (watchdogAudible && player.unMute) player.unMute();
					if (watchdogAudible && player.setVolume) player.setVolume(100);
					if (player.playVideo) player.playVideo();
				}

				if (watchdogAudible) {
					video.muted = false;
					video.volume = 1;
				}

				// Et la balise elle-meme, qui peut etre en pause alors que le
				// lecteur se croit parti. `play()` rend une promesse qui EST
				// rejetee quand le navigateur refuse : sans le `catch`, la
				// console se remplit d erreurs qui ne veulent rien dire.
				var promise = video.play();

				if (promise && promise.catch) promise.catch(function () {});
			} catch (error) {
				// Un lecteur pas encore pret leve : le tour suivant reessaiera.
			}
		}, 250);
	}

	/** Reposer le volume puis relancer les deux niveaux du lecteur. */
	function wake() {
		try {
			if (player) {
				if (linked && player.unMute) player.unMute();
				if (linked && player.setVolume) player.setVolume(100);
				if (player.playVideo) player.playVideo();
			}

			if (window.videoSource) {
				if (linked) {
					window.videoSource.muted = false;
					window.videoSource.volume = 1;
				}

				var promise = window.videoSource.play();

				if (promise && promise.catch) promise.catch(function () {});
			}
		} catch (error) {
			// Le lecteur peut etre entre deux etats : le chien de garde reessaie.
		}

		keepPlaying(linked);
	}

	function start() {
		if (!videoId) return tell("error", { message: "identifiant manquant" });

		player = new YT.Player("player", {
			width: 356,
			height: 200,
			videoId: videoId,
			host: "https://www.youtube-nocookie.com",
			playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1 },
			events: {
				onReady: function (event) {
					// Muet du cote du lecteur : tout le son passera par la
					// chaine spatiale du parent, jamais par la sortie directe.
					event.target.mute();

					if (seek > 0) event.target.seekTo(seek, true);

					event.target.playVideo();
					grabVideo(0);
					keepPlaying(false);
				},

				onStateChange: function (event) {
					if (event.data === YT.PlayerState.ENDED) {
						if (loop) return event.target.seekTo(0, true);

						tell("ended");
					}
				},

				onError: function (event) {
					tell("error", { message: "lecteur : " + event.data });
				},
			},
		});

		var iframe = player && player.getIframe ? player.getIframe() : null;

		if (iframe) iframe.setAttribute("allow", "autoplay; encrypted-media");
	}

	// L API se charge de son cote : elle previent quand elle est prete, et si
	// elle l etait deja on part tout de suite.
	if (window.YT && window.YT.Player) {
		start();
	} else {
		window.onYouTubeIframeAPIReady = start;
	}

	window.addEventListener("message", function (event) {
		var message = event.data;

		if (!message || !message.type) return;

		// Le parent a branche la balise dans sa chaine : on peut rendre le son.
		//
		// Le lecteur demarre muet pour avoir le droit de partir tout seul, mais
		// une balise muette ne produit AUCUN signal, pas meme vers un moteur
		// audio — la coupure est a la source. Sans ce reveil, elle avance dans
		// le vide et personne n entend rien.
		if (message.type === "unmute") {
			linked = true;
			wake();

			return;
		}

		if (message.type === "wake") {
			wake();

			return;
		}

		if (message.type !== "destroy" || !player) return;

		try {
			player.stopVideo();
			player.destroy();
		} catch (error) {
			// Un lecteur deja parti leve : il n y a rien a rattraper.
		}

		window.videoSource = undefined;

		if (watchdog !== null) window.clearInterval(watchdog);

		watchdog = null;
		player = null;
	});
})();
