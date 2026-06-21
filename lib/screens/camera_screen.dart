import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../models/photo_session.dart';

/// Resultado de uma captura: o caminho temporario da imagem, a distancia
/// registrada e os parametros de captura usados.
class CaptureResult {
  final String imagePath;
  final double distanceCm;
  final CaptureParams params;

  const CaptureResult({
    required this.imagePath,
    required this.distanceCm,
    required this.params,
  });
}

/// Tela de camera reutilizavel.
///
/// - [ghostImagePath]: se informado, mostra a foto base sobreposta
///   (Ghost Overlay) para alinhar a 2a foto.
/// - [targetDistanceCm]: distancia-alvo a ser repetida (mostrada na tela).
/// - [initialParams]: parametros da foto base, reaplicados para deixar a
///   2a foto semelhante (exposicao travada + offset, zoom, flash).
class CameraScreen extends StatefulWidget {
  final String title;
  final String? ghostImagePath;
  final double? targetDistanceCm;
  final CaptureParams? initialParams;

  const CameraScreen({
    super.key,
    required this.title,
    this.ghostImagePath,
    this.targetDistanceCm,
    this.initialParams,
  });

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen>
    with WidgetsBindingObserver {
  CameraController? _controller;
  Future<void>? _initFuture;
  String? _error;

  // Controles
  bool _flashOn = true;
  bool _exposureLocked = false;
  double _ghostOpacity = 0.5;

  double _exposureOffset = 0.0;
  double _minExposure = 0.0;
  double _maxExposure = 0.0;

  double _zoom = 1.0;
  double _minZoom = 1.0;
  double _maxZoom = 1.0;

  bool _capturing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final params = widget.initialParams;
    if (params != null) {
      _flashOn = params.flashOn;
      _exposureOffset = params.exposureOffset;
      _zoom = params.zoom;
      // Reaplicar parametros da base implica travar a exposicao para manter
      // a 2a foto o mais parecida possivel com a base.
      _exposureLocked = true;
    }
    _initFuture = _setupCamera();
  }

  Future<void> _setupCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _error = 'Nenhuma camera encontrada neste aparelho.');
        return;
      }
      final back = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final controller = CameraController(
        back,
        ResolutionPreset.veryHigh,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await controller.initialize();
      _controller = controller;

      // Faixas de exposicao e zoom (variam por aparelho).
      try {
        _minExposure = await controller.getMinExposureOffset();
        _maxExposure = await controller.getMaxExposureOffset();
      } catch (_) {}
      try {
        _minZoom = await controller.getMinZoomLevel();
        _maxZoom = await controller.getMaxZoomLevel();
      } catch (_) {}

      _exposureOffset =
          _exposureOffset.clamp(_minExposure, _maxExposure).toDouble();
      _zoom = _zoom.clamp(_minZoom, _maxZoom).toDouble();

      await _applyFlash();
      await _applyExposure();
      await _applyZoom();
      if (_exposureLocked) {
        await _setExposureLocked(true);
      }

      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) setState(() => _error = 'Erro ao abrir a camera: $e');
    }
  }

  Future<void> _applyFlash() async {
    final c = _controller;
    if (c == null) return;
    try {
      // Torch = lanterna continua, ligada durante posicionamento E foto.
      await c.setFlashMode(_flashOn ? FlashMode.torch : FlashMode.off);
    } catch (_) {}
  }

  Future<void> _applyExposure() async {
    final c = _controller;
    if (c == null) return;
    try {
      await c.setExposureOffset(_exposureOffset);
    } catch (_) {}
  }

  Future<void> _applyZoom() async {
    final c = _controller;
    if (c == null) return;
    try {
      await c.setZoomLevel(_zoom);
    } catch (_) {}
  }

  Future<void> _setExposureLocked(bool locked) async {
    final c = _controller;
    if (c == null) return;
    try {
      await c.setExposureMode(locked ? ExposureMode.locked : ExposureMode.auto);
      await c.setFocusMode(locked ? FocusMode.locked : FocusMode.auto);
    } catch (_) {}
    if (mounted) setState(() => _exposureLocked = locked);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      c.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initFuture = _setupCamera();
      setState(() {});
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _capture() async {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _capturing) return;
    setState(() => _capturing = true);
    try {
      // Garante que a lanterna continue no estado escolhido na captura.
      await _applyFlash();
      final file = await c.takePicture();
      if (!mounted) return;
      final distance = await _askDistance();
      if (distance == null) {
        setState(() => _capturing = false);
        return; // usuario cancelou a confirmacao de distancia
      }
      if (!mounted) return;
      Navigator.of(context).pop(
        CaptureResult(
          imagePath: file.path,
          distanceCm: distance,
          params: CaptureParams(
            exposureOffset: _exposureOffset,
            zoom: _zoom,
            flashOn: _flashOn,
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        setState(() => _capturing = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao capturar: $e')),
        );
      }
    }
  }

  /// Confirmacao da distancia (cm). Pre-preenche com a meta (2a foto) ou 50.
  Future<double?> _askDistance() async {
    final initial = (widget.targetDistanceCm ?? 50).round();
    final controller = TextEditingController(text: initial.toString());
    return showDialog<double>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Distancia da foto'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (widget.targetDistanceCm != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Meta para igualar a foto base: '
                    '${widget.targetDistanceCm!.round()} cm',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              TextField(
                controller: controller,
                keyboardType: TextInputType.number,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Distancia (cm)',
                  helperText: 'Recomendado: 40 a 60 cm',
                  suffixText: 'cm',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Refazer'),
            ),
            FilledButton(
              onPressed: () {
                final v = double.tryParse(
                    controller.text.replaceAll(',', '.').trim());
                Navigator.of(ctx).pop(v ?? initial.toDouble());
              },
              child: const Text('Salvar'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: FutureBuilder<void>(
          future: _initFuture,
          builder: (context, snapshot) {
            if (_error != null) {
              return _ErrorView(message: _error!);
            }
            final c = _controller;
            if (c == null || !c.value.isInitialized) {
              return const Center(
                child: CircularProgressIndicator(color: Colors.white),
              );
            }
            return Stack(
              fit: StackFit.expand,
              children: [
                Center(child: CameraPreview(c)),
                // Ghost Overlay (foto base sobreposta)
                if (widget.ghostImagePath != null)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: Opacity(
                        opacity: _ghostOpacity,
                        child: Image.file(
                          File(widget.ghostImagePath!),
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  ),
                _buildTopBar(),
                _buildSideControls(),
                _buildBottomBar(),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        color: Colors.black54,
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white),
              onPressed: () => Navigator.of(context).pop(),
            ),
            Expanded(
              child: Text(
                widget.title,
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold),
              ),
            ),
            // Lanterna / flash continuo
            IconButton(
              tooltip: _flashOn ? 'Lanterna ligada' : 'Lanterna desligada',
              icon: Icon(
                _flashOn ? Icons.flashlight_on : Icons.flashlight_off,
                color: _flashOn ? Colors.amber : Colors.white,
              ),
              onPressed: () async {
                setState(() => _flashOn = !_flashOn);
                await _applyFlash();
              },
            ),
            // Travar exposicao/foco
            IconButton(
              tooltip:
                  _exposureLocked ? 'Exposicao travada' : 'Exposicao automatica',
              icon: Icon(
                _exposureLocked ? Icons.lock : Icons.lock_open,
                color: _exposureLocked ? Colors.amber : Colors.white,
              ),
              onPressed: () => _setExposureLocked(!_exposureLocked),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSideControls() {
    return Positioned(
      right: 8,
      top: 80,
      bottom: 120,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (widget.ghostImagePath != null) ...[
            const Icon(Icons.opacity, color: Colors.white, size: 20),
            Expanded(
              child: RotatedBox(
                quarterTurns: 3,
                child: Slider(
                  value: _ghostOpacity,
                  onChanged: (v) => setState(() => _ghostOpacity = v),
                ),
              ),
            ),
          ],
          const Icon(Icons.brightness_6, color: Colors.white, size: 20),
          Expanded(
            child: RotatedBox(
              quarterTurns: 3,
              child: Slider(
                value:
                    _exposureOffset.clamp(_minExposure, _maxExposure).toDouble(),
                min: _minExposure,
                max: _maxExposure == _minExposure
                    ? _minExposure + 1
                    : _maxExposure,
                onChanged: _maxExposure == _minExposure
                    ? null
                    : (v) {
                        setState(() => _exposureOffset = v);
                        _applyExposure();
                      },
              ),
            ),
          ),
          const Icon(Icons.zoom_in, color: Colors.white, size: 20),
          Expanded(
            child: RotatedBox(
              quarterTurns: 3,
              child: Slider(
                value: _zoom.clamp(_minZoom, _maxZoom).toDouble(),
                min: _minZoom,
                max: _maxZoom == _minZoom ? _minZoom + 1 : _maxZoom,
                onChanged: _maxZoom == _minZoom
                    ? null
                    : (v) {
                        setState(() => _zoom = v);
                        _applyZoom();
                      },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    final target = widget.targetDistanceCm;
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        color: Colors.black54,
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.black45,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                target != null
                    ? 'Distancia-alvo: ${target.round()} cm  (mantenha 40-60 cm)'
                    : 'Mantenha 40-60 cm do local',
                style: const TextStyle(color: Colors.white),
              ),
            ),
            GestureDetector(
              onTap: _capturing ? null : _capture,
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(color: Colors.amber, width: 4),
                ),
                child: _capturing
                    ? const Padding(
                        padding: EdgeInsets.all(18),
                        child: CircularProgressIndicator(strokeWidth: 3),
                      )
                    : const Icon(Icons.camera_alt,
                        color: Colors.black, size: 32),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  const _ErrorView({required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.white, size: 48),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Voltar'),
            ),
          ],
        ),
      ),
    );
  }
}
