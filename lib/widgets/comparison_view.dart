import 'dart:io';

import 'package:flutter/material.dart';

/// Visualizacao antes/depois com tres modos:
/// - Cortina (arraste para revelar a foto de acompanhamento sobre a base)
/// - Lado a lado
/// - Sobreposicao (ajuste a opacidade)
class ComparisonView extends StatefulWidget {
  final String beforePath;
  final String afterPath;

  const ComparisonView({
    super.key,
    required this.beforePath,
    required this.afterPath,
  });

  @override
  State<ComparisonView> createState() => _ComparisonViewState();
}

enum _Mode { curtain, side, overlay }

class _ComparisonViewState extends State<ComparisonView> {
  _Mode _mode = _Mode.curtain;
  double _split = 0.5;
  double _overlayOpacity = 0.5;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SegmentedButton<_Mode>(
          segments: const [
            ButtonSegment(
                value: _Mode.curtain,
                icon: Icon(Icons.compare),
                label: Text('Cortina')),
            ButtonSegment(
                value: _Mode.side,
                icon: Icon(Icons.view_column),
                label: Text('Lado a lado')),
            ButtonSegment(
                value: _Mode.overlay,
                icon: Icon(Icons.layers),
                label: Text('Sobrepor')),
          ],
          selected: {_mode},
          onSelectionChanged: (s) => setState(() => _mode = s.first),
        ),
        const SizedBox(height: 12),
        AspectRatio(
          aspectRatio: 3 / 4,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: _buildContent(),
          ),
        ),
        if (_mode == _Mode.curtain)
          _LabeledSlider(
            left: 'Base',
            right: 'Depois',
            value: _split,
            onChanged: (v) => setState(() => _split = v),
          ),
        if (_mode == _Mode.overlay)
          _LabeledSlider(
            left: 'Base',
            right: 'Depois',
            value: _overlayOpacity,
            onChanged: (v) => setState(() => _overlayOpacity = v),
          ),
      ],
    );
  }

  Widget _buildContent() {
    switch (_mode) {
      case _Mode.side:
        return Row(
          children: [
            Expanded(child: _img(widget.beforePath)),
            const SizedBox(width: 2),
            Expanded(child: _img(widget.afterPath)),
          ],
        );
      case _Mode.overlay:
        return Stack(
          fit: StackFit.expand,
          children: [
            _img(widget.beforePath),
            Opacity(opacity: _overlayOpacity, child: _img(widget.afterPath)),
          ],
        );
      case _Mode.curtain:
        return LayoutBuilder(
          builder: (context, constraints) {
            final w = constraints.maxWidth;
            return GestureDetector(
              onHorizontalDragUpdate: (d) {
                setState(() {
                  _split = (_split + d.delta.dx / w).clamp(0.0, 1.0).toDouble();
                });
              },
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _img(widget.beforePath),
                  ClipRect(
                    clipper: _RightClipper(_split),
                    child: _img(widget.afterPath),
                  ),
                  Positioned(
                    left: w * _split - 1,
                    top: 0,
                    bottom: 0,
                    child: Container(width: 2, color: Colors.white),
                  ),
                  Positioned(
                    left: w * _split - 16,
                    top: 0,
                    bottom: 0,
                    child: const Center(
                      child: CircleAvatar(
                        radius: 16,
                        backgroundColor: Colors.white,
                        child: Icon(Icons.drag_indicator,
                            color: Colors.black, size: 18),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
    }
  }

  Widget _img(String path) =>
      Image.file(File(path), fit: BoxFit.cover, width: double.infinity);
}

class _RightClipper extends CustomClipper<Rect> {
  final double split;
  _RightClipper(this.split);

  @override
  Rect getClip(Size size) =>
      Rect.fromLTRB(size.width * split, 0, size.width, size.height);

  @override
  bool shouldReclip(covariant _RightClipper oldClipper) =>
      oldClipper.split != split;
}

class _LabeledSlider extends StatelessWidget {
  final String left;
  final String right;
  final double value;
  final ValueChanged<double> onChanged;

  const _LabeledSlider({
    required this.left,
    required this.right,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(left),
        Expanded(child: Slider(value: value, onChanged: onChanged)),
        Text(right),
      ],
    );
  }
}
